// 15-minute rollups into topic_stats_15m, the table the board reads. Buckets are aligned to UTC
// quarter-hours, which are also IST quarter-hours (IST = UTC+05:30). Rows are sparse (items > 0)
// and store raw counts only; the 30-item split rule is applied at read time (04-01).
//
// Reach (06-01): every run first refreshes posts.reach_score (trust/reach.ts). The reach_* columns
// sum reach_score per sentiment, with a NULL score counted as the unknown score. After a full
// rescore, recomputeReachColumns rewrites only the reach columns over the last 7 days so older
// buckets match the new per-source p95.
//
// Coordination (06-02): after the reach refresh, near-duplicate coordination is detected
// (trust/coordination.ts) and suspected_coordinated is refreshed in already rolled-up buckets that
// hold newly flagged posts. Each recompute also counts flagged posts per slice and sets burst_flag
// and top5_author_share (rollup/coordination.ts).
//
// Interfaces used by 06-01 and 07-01: runRollup, recomputeRange, bucketStart.
import { getLatestConfig, type Db } from '@jio/db'
import type { Sql } from '../triage/repo'
import { resolveTrustConfig, TRUST_DEFAULTS, type CoordinationConfig } from '../trust/config'
import { detectNearDupCoordination } from '../trust/coordination'
import { lastFullRescoreAt, refreshReachScores, shouldFullRescore } from '../trust/reach'
import { ACTIVE_MIN_ITEMS_24H, refreshTopicStatus, type TopicStatusCounts } from './active'
import { applyCoordinationColumns, refreshSuspectedCounts } from './coordination'
import { fanned } from './fan'

export { ACTIVE_MIN_ITEMS_24H, refreshTopicStatus, type TopicStatusCounts } from './active'

export type RollupHandle = { db: Db; sql: Sql }
export type RollupMode = 'recent' | 'full7d'

export const BUCKET_MS = 15 * 60_000
export const FULL_WINDOW_MS = 7 * 24 * 3_600_000
/** A 'recent' run also recomputes buckets of posts labelled (or corrected) within this window. */
export const RECENT_LABEL_WINDOW_MS = 3 * 60_000
/** UTC minute of the hour at which an unspecified run widens to 'full7d'. */
export const FULL_RUN_MINUTE = 7

export function bucketStart(d: Date): Date {
  return new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS)
}

function bucketCeil(d: Date): Date {
  return new Date(Math.ceil(d.getTime() / BUCKET_MS) * BUCKET_MS)
}

export function resolveRollupMode(now: Date, mode?: RollupMode): RollupMode {
  if (mode) return mode
  return now.getUTCMinutes() === FULL_RUN_MINUTE ? 'full7d' : 'recent'
}

/** Distinct bucket starts merged into contiguous half-open [from, to) ranges, ascending. */
export function bucketRanges(buckets: Date[]): { from: Date; to: Date }[] {
  const starts = [...new Set(buckets.map((b) => bucketStart(b).getTime()))].sort((a, b) => a - b)
  const out: { from: Date; to: Date }[] = []
  for (const s of starts) {
    const last = out[out.length - 1]
    if (last && last.to.getTime() === s) last.to = new Date(s + BUCKET_MS)
    else out.push({ from: new Date(s), to: new Date(s + BUCKET_MS) })
  }
  return out
}

export type RecomputeOptions = {
  /** Reach counted for a post whose reach_score is NULL (default TRUST_DEFAULTS.reach.unknownScore). */
  unknownScore?: number
  /** Burst and top-5 thresholds (default TRUST_DEFAULTS.coordination). */
  coordination?: CoordinationConfig
}

/**
 * Recomputes every bucket in [from, to) (widened to whole buckets) in one transaction: upserts the
 * counts, reach sums and suspected_coordinated produced from posts x effective_classifications,
 * deletes rows in the range that are no longer produced (a relabel that empties a slice leaves
 * nothing stale), then sets burst_flag and top5_author_share on the rows in the range. Returns the
 * number of rows written.
 */
export async function recomputeRange(
  h: { sql: Sql },
  range: { from: Date; to: Date },
  opts: RecomputeOptions = {},
): Promise<{ rows: number }> {
  const from = bucketStart(range.from)
  const to = bucketCeil(range.to)
  if (to <= from) return { rows: 0 }
  const unknown = opts.unknownScore ?? TRUST_DEFAULTS.reach.unknownScore
  const coordination = opts.coordination ?? TRUST_DEFAULTS.coordination
  const rows = await h.sql.begin(async (tx) => {
    const res = await tx<{ n: number }[]>`
      with ${fanned(tx as unknown as Sql, from, to, unknown)},
      agg as (
        select bucket_start, topic_id, entity, lane,
               count(*)::int as items,
               (count(*) filter (where sentiment = 'positive'))::int as pos,
               (count(*) filter (where sentiment = 'neutral'))::int as neu,
               (count(*) filter (where sentiment = 'negative'))::int as neg,
               (count(*) filter (where confidence = 'low'))::int as low_conf,
               coalesce(sum(reach) filter (where sentiment = 'positive'), 0)::real as reach_pos,
               coalesce(sum(reach) filter (where sentiment = 'neutral'), 0)::real as reach_neu,
               coalesce(sum(reach) filter (where sentiment = 'negative'), 0)::real as reach_neg,
               (count(*) filter (where coord_suspected))::int as suspected_coordinated
        from fan
        group by bucket_start, topic_id, entity, lane
      ),
      up as (
        insert into topic_stats_15m as t
          (bucket_start, topic_id, entity, lane, items, pos, neu, neg, low_conf,
           reach_pos, reach_neu, reach_neg, suspected_coordinated, updated_at)
        select bucket_start, topic_id, entity, lane, items, pos, neu, neg, low_conf,
               reach_pos, reach_neu, reach_neg, suspected_coordinated, now()
        from agg
        on conflict (bucket_start, topic_id, entity, lane) do update set
          items = excluded.items, pos = excluded.pos, neu = excluded.neu, neg = excluded.neg,
          low_conf = excluded.low_conf, reach_pos = excluded.reach_pos,
          reach_neu = excluded.reach_neu, reach_neg = excluded.reach_neg,
          suspected_coordinated = excluded.suspected_coordinated,
          burst_flag = false, top5_author_share = null,
          updated_at = excluded.updated_at
        returning t.bucket_start, t.topic_id, t.entity, t.lane
      ),
      del as (
        delete from topic_stats_15m t
        where t.bucket_start >= ${from.toISOString()}::timestamptz
          and t.bucket_start < ${to.toISOString()}::timestamptz
          and not exists (
            select 1 from up u
            where u.bucket_start = t.bucket_start and u.topic_id = t.topic_id
              and u.entity = t.entity and u.lane = t.lane)
        returning 1
      )
      select (select count(*) from up)::int as n, (select count(*) from del)::int as d`
    await applyCoordinationColumns(tx as unknown as Sql, { from, to }, coordination, unknown)
    return res[0]?.n ?? 0
  })
  return { rows }
}

/**
 * Rewrites only reach_pos/neu/neg of the existing topic_stats_15m rows in [from, to) (widened to
 * whole buckets) in one set-based UPDATE, after a full reach rescore changed the per-source p95.
 * Counts, coordination columns and the set of rows are untouched. Returns the rows updated.
 */
export async function recomputeReachColumns(
  h: { sql: Sql },
  range: { from: Date; to: Date },
  opts: RecomputeOptions = {},
): Promise<{ rows: number }> {
  const from = bucketStart(range.from)
  const to = bucketCeil(range.to)
  if (to <= from) return { rows: 0 }
  const unknown = opts.unknownScore ?? TRUST_DEFAULTS.reach.unknownScore
  const res = await h.sql`
    with ${fanned(h.sql, from, to, unknown)},
    agg as (
      select bucket_start, topic_id, entity, lane,
             coalesce(sum(reach) filter (where sentiment = 'positive'), 0)::real as reach_pos,
             coalesce(sum(reach) filter (where sentiment = 'neutral'), 0)::real as reach_neu,
             coalesce(sum(reach) filter (where sentiment = 'negative'), 0)::real as reach_neg
      from fan
      group by bucket_start, topic_id, entity, lane
    )
    update topic_stats_15m t
    set reach_pos = a.reach_pos, reach_neu = a.reach_neu, reach_neg = a.reach_neg,
        updated_at = now()
    from agg a
    where t.bucket_start = a.bucket_start and t.topic_id = a.topic_id
      and t.entity = a.entity and t.lane = a.lane
      and t.bucket_start >= ${from.toISOString()}::timestamptz
      and t.bucket_start < ${to.toISOString()}::timestamptz`
  return { rows: res.count }
}

export type RollupResult = {
  mode: RollupMode
  /** Buckets recomputed. */
  buckets: number
  /** Rows upserted. */
  rows: number
  status: TopicStatusCounts
  /** Reach scores written this run, and whether it was a full rescore. */
  reach: { updated: number; full: boolean }
  /** Posts newly flagged as suspected coordinated, and older rows whose count was refreshed. */
  coordination: { flagged: number; refreshedRows: number }
}

/**
 * 'full7d' recomputes [bucketStart(now) - 7d, bucketStart(now) + 15m). 'recent' recomputes the
 * current and previous buckets plus the buckets of posts whose classification rows were created
 * in the last 3 minutes (new labels and corrections), limited to the last 7 days so rollups whose
 * posts retention may have removed are never rewritten. Then refreshes active/dormant status.
 *
 * Before any bucket is recomputed, posts.reach_score is refreshed: a full rescore every
 * `trust.reach.fullRescoreEveryMin` (and on the first run in a process), otherwise only unscored
 * posts. After a full rescore in a 'recent' run, the reach columns of the last 7 days are
 * rewritten (a 'full7d' run already recomputes that whole window).
 *
 * Then near-duplicate coordination is detected over the last 26h; when posts were newly flagged,
 * suspected_coordinated is refreshed in the existing rows of their buckets (06-02).
 */
export async function runRollup(
  h: RollupHandle,
  now: Date = new Date(),
  opts: { mode?: RollupMode } = {},
): Promise<RollupResult> {
  const mode = resolveRollupMode(now, opts.mode)
  const { config } = await getLatestConfig(h.db)
  const trust = resolveTrustConfig(config)
  const full = shouldFullRescore(lastFullRescoreAt(), now, trust.reach)
  const reach = await refreshReachScores(h, now, trust.reach, { full })
  const unknownScore = trust.reach.unknownScore
  const coordination = trust.coordination
  const { flagged } = await detectNearDupCoordination(h, now, coordination)
  const refreshedRows = flagged > 0 ? await refreshSuspectedCounts(h, now) : 0

  const cur = bucketStart(now)
  const windowFrom = new Date(cur.getTime() - FULL_WINDOW_MS)
  const windowTo = new Date(cur.getTime() + BUCKET_MS)

  let ranges: { from: Date; to: Date }[]
  if (mode === 'full7d') {
    ranges = [{ from: windowFrom, to: windowTo }]
  } else {
    const since = new Date(now.getTime() - RECENT_LABEL_WINDOW_MS)
    const touched = await h.sql<{ b: string | Date }[]>`
      select distinct date_bin('15 minutes', p.published_at, timestamptz '2000-01-01 00:00:00+00')
               as b
      from classifications c
      join posts p on p.id = c.post_id
      where c.created_at >= ${since.toISOString()}::timestamptz
        and p.published_at >= ${windowFrom.toISOString()}::timestamptz
        and p.published_at < ${windowTo.toISOString()}::timestamptz`
    ranges = bucketRanges([
      cur,
      new Date(cur.getTime() - BUCKET_MS),
      ...touched.map((r) => new Date(r.b)),
    ])
  }

  let rows = 0
  let buckets = 0
  for (const r of ranges) {
    rows += (await recomputeRange(h, r, { unknownScore, coordination })).rows
    buckets += Math.round((r.to.getTime() - r.from.getTime()) / BUCKET_MS)
  }
  if (full && mode !== 'full7d') {
    await recomputeReachColumns(h, { from: windowFrom, to: windowTo }, { unknownScore })
  }

  const minItems = config.active_min_items_24h ?? ACTIVE_MIN_ITEMS_24H
  const status = await refreshTopicStatus(h, now, minItems)
  return {
    mode,
    buckets,
    rows,
    status,
    reach: { updated: reach.updated, full },
    coordination: { flagged, refreshedRows },
  }
}
