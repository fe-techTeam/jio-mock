// Per-post reach scores (0-1), normalized per source so a raw follower count never reads as
// public opinion. A source's main metric is log-scaled and divided by that source's p95 over the
// lookback window; media-lane posts get a fixed outlet weight and a missing metric a fixed score.
//
// refreshReachScores runs at the start of every rollup: a full pass (every fullRescoreEveryMin)
// recomputes p95 per source and rescores the lookback window; otherwise only unscored rows are
// scored with the cached p95.
import { SOURCE_KEYS, type Lane, type SourceKey } from '@jio/core'
import type { Sql } from '../triage/repo'
import type { ReachConfig } from './config'

export type ReachRow = {
  sourceKey: SourceKey
  lane: Lane
  reachRaw: Record<string, number>
  /** authors.followers, used only when reach_raw has no followers figure. */
  authorFollowers?: number | null
}

const FOLLOWER_SOURCES: ReadonlySet<SourceKey> = new Set(['x_api', 'x_apify', 'apify_linkedin'])
const METRIC_KEY: Partial<Record<SourceKey, string>> = {
  youtube: 'views',
  reddit: 'upvotes',
  apify_instagram: 'likes',
}

function valid(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** The source's main reach metric, or undefined when the source has none or the post lacks it. */
export function mainMetric(
  sourceKey: SourceKey,
  reachRaw: Record<string, number>,
  authorFollowers?: number | null,
): number | undefined {
  if (FOLLOWER_SOURCES.has(sourceKey)) {
    return valid(reachRaw.followers) ?? valid(authorFollowers ?? undefined)
  }
  const key = METRIC_KEY[sourceKey]
  return key ? valid(reachRaw[key]) : undefined
}

/** Percentile p (0-1) with linear interpolation between closest ranks; 0 for an empty array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const xs = [...values].sort((a, b) => a - b)
  const idx = (xs.length - 1) * Math.min(Math.max(p, 0), 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (idx - lo)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

export function computeReachScore(row: ReachRow, p95Log: number, cfg: ReachConfig): number {
  if (row.lane === 'media') return cfg.mediaOutletWeight
  const m = mainMetric(row.sourceKey, row.reachRaw, row.authorFollowers)
  if (m === undefined) return cfg.unknownScore
  const denom = p95Log > 0 ? p95Log : 1
  return clamp(Math.log10(1 + m) / denom, cfg.floor, 1)
}

/** p95 of log10(1 + metric) per source over social rows, or the source default with too few. */
export function p95LogBySource(rows: ReachRow[], cfg: ReachConfig): Record<SourceKey, number> {
  const samples = new Map<SourceKey, number[]>()
  for (const r of rows) {
    if (r.lane !== 'social') continue
    const m = mainMetric(r.sourceKey, r.reachRaw, r.authorFollowers)
    if (m === undefined) continue
    const list = samples.get(r.sourceKey) ?? []
    list.push(Math.log10(1 + m))
    samples.set(r.sourceKey, list)
  }
  const out = {} as Record<SourceKey, number>
  for (const key of SOURCE_KEYS) {
    const xs = samples.get(key) ?? []
    out[key] =
      xs.length >= cfg.minSamplesForPercentile
        ? percentile(xs, cfg.percentile)
        : (cfg.defaultP95Log[key] ?? 4)
  }
  return out
}

export function shouldFullRescore(lastFullAt: Date | null, now: Date, cfg: ReachConfig): boolean {
  if (!lastFullAt) return true
  return now.getTime() - lastFullAt.getTime() >= cfg.fullRescoreEveryMin * 60_000
}

// ---- DB pass -------------------------------------------------------------------------------

type ReachCache = { p95: Record<SourceKey, number>; at: Date }
let cache: ReachCache | null = null

/** When the cached p95 was computed (the last full pass in this process), or null. */
export function lastFullRescoreAt(): Date | null {
  return cache ? new Date(cache.at) : null
}

/** The cached p95 per source from the last full pass, or null. */
export function cachedP95Log(): Record<SourceKey, number> | null {
  return cache ? { ...cache.p95 } : null
}

/** Clears the module cache (tests, or after a config change). */
export function resetReachCache(): void {
  cache = null
}

const WRITE_CHUNK = 500

type DbRow = {
  id: string
  source_key: SourceKey
  lane: Lane
  reach_raw: unknown
  followers: number | null
  in_window: boolean
}

function parseRaw(v: unknown): Record<string, number> {
  let obj = v
  if (typeof v === 'string') {
    try {
      obj = JSON.parse(v)
    } catch {
      return {}
    }
  }
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj)
    ? (obj as Record<string, number>)
    : {}
}

function toReachRow(r: DbRow): ReachRow {
  return {
    sourceKey: r.source_key,
    lane: r.lane,
    reachRaw: parseRaw(r.reach_raw),
    authorFollowers: r.followers,
  }
}

async function writeScores(sql: Sql, scored: [string, number][]): Promise<number> {
  let updated = 0
  for (let i = 0; i < scored.length; i += WRITE_CHUNK) {
    const chunk = scored.slice(i, i + WRITE_CHUNK).map(([id, s]) => [id, String(s)])
    const res = await sql`
      update posts set reach_score = v.s::real
      from (values ${sql(chunk)}) as v(id, s)
      where posts.id = v.id::uuid
        and posts.reach_score is distinct from v.s::real`
    updated += res.count
  }
  return updated
}

/**
 * Full: recomputes p95 per source from posts published in the last lookbackDays (followers from a
 * LEFT JOIN on authors, used only for this aggregate), caches it, and rescores those posts plus
 * any older post that has no score yet. Incremental: scores only rows whose reach_score IS NULL
 * with the cached p95, and runs a full pass when nothing is cached. Returns rows written.
 */
export async function refreshReachScores(
  h: { sql: Sql },
  now: Date,
  cfg: ReachConfig,
  opts: { full: boolean },
): Promise<{ updated: number }> {
  const full = opts.full || cache === null
  const since = new Date(now.getTime() - cfg.lookbackDays * 86_400_000).toISOString()
  const rows = full
    ? await h.sql<DbRow[]>`
        select p.id, p.source_key, p.lane, p.reach_raw, a.followers,
               (p.published_at >= ${since}::timestamptz) as in_window
        from posts p
        left join authors a on a.id = p.author_id
        where p.published_at >= ${since}::timestamptz or p.reach_score is null`
    : await h.sql<DbRow[]>`
        select p.id, p.source_key, p.lane, p.reach_raw, a.followers, true as in_window
        from posts p
        left join authors a on a.id = p.author_id
        where p.reach_score is null`

  let p95: Record<SourceKey, number>
  if (full) {
    p95 = p95LogBySource(rows.filter((r) => r.in_window).map(toReachRow), cfg)
    cache = { p95, at: new Date(now) }
  } else {
    p95 = cache!.p95
  }

  const scored: [string, number][] = rows.map((r) => {
    const row = toReachRow(r)
    return [r.id, computeReachScore(row, p95[row.sourceKey] ?? 4, cfg)]
  })
  return { updated: await writeScores(h.sql, scored) }
}
