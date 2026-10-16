// Coordination columns of topic_stats_15m (06-02): burst_flag and top5_author_share for the
// buckets being recomputed, and a targeted refresh of suspected_coordinated after near-duplicate
// detection flags posts in buckets that were already rolled up. Author ids are only aggregated
// here; topic_stats_15m stores the share, never an id or handle.
import type { Sql } from '../triage/repo'
import type { CoordinationConfig } from '../trust/config'
import { isBurst, top5Share } from '../trust/coordination'
import { fanned } from './fan'

const BUCKET_MS = 15 * 60_000
/** Buckets in the trailing 24h window (the burst baseline and the top-5 share window). */
export const TRAILING_BUCKETS = 96
const DAY_MS = TRAILING_BUCKETS * BUCKET_MS

type Key = string
const keyOf = (topicId: string, entity: string, lane: string): Key => `${topicId}|${entity}|${lane}`

const ms = (v: string | Date) => new Date(v).getTime()

/**
 * topic_stats_15m items per (topic, entity, lane) per bucket over [from - 24h, to). Missing
 * buckets are simply absent (read as 0).
 */
async function trailingItems(
  tx: Sql,
  from: Date,
  to: Date,
): Promise<Map<Key, Map<number, number>>> {
  const rows = await tx<
    { bucket_start: string | Date; topic_id: string; entity: string; lane: string; items: number }[]
  >`
    select bucket_start, topic_id, entity, lane, items
    from topic_stats_15m
    where bucket_start >= ${new Date(from.getTime() - DAY_MS).toISOString()}::timestamptz
      and bucket_start < ${to.toISOString()}::timestamptz`
  const out = new Map<Key, Map<number, number>>()
  for (const r of rows) {
    const k = keyOf(r.topic_id, r.entity, r.lane)
    let m = out.get(k)
    if (!m) out.set(k, (m = new Map()))
    m.set(ms(r.bucket_start), r.items)
  }
  return out
}

type BucketAuthors = { bucket: number; total: number; byAuthor: Map<string, number> }

/**
 * Per (topic, entity, lane) and bucket: post count and posts per non-null author over
 * [from - 24h + 15m, to), from posts x effective_classifications (the same fan-out as the rollup).
 */
async function authorCounts(
  tx: Sql,
  from: Date,
  to: Date,
  unknown: number,
): Promise<Map<Key, BucketAuthors[]>> {
  const start = new Date(from.getTime() - DAY_MS + BUCKET_MS)
  const rows = await tx<
    {
      bucket_start: string | Date
      topic_id: string
      entity: string
      lane: string
      author_id: string | null
      n: number
    }[]
  >`
    with ${fanned(tx, start, to, unknown)}
    select bucket_start, topic_id, entity, lane, author_id::text as author_id, count(*)::int as n
    from fan
    group by bucket_start, topic_id, entity, lane, author_id`
  const byKey = new Map<Key, Map<number, BucketAuthors>>()
  for (const r of rows) {
    const k = keyOf(r.topic_id, r.entity, r.lane)
    let buckets = byKey.get(k)
    if (!buckets) byKey.set(k, (buckets = new Map()))
    const b = ms(r.bucket_start)
    let e = buckets.get(b)
    if (!e) buckets.set(b, (e = { bucket: b, total: 0, byAuthor: new Map() }))
    e.total += r.n
    if (r.author_id) e.byAuthor.set(r.author_id, (e.byAuthor.get(r.author_id) ?? 0) + r.n)
  }
  const out = new Map<Key, BucketAuthors[]>()
  for (const [k, m] of byKey)
    out.set(
      k,
      [...m.values()].sort((a, b) => a.bucket - b.bucket),
    )
  return out
}

/**
 * Sets burst_flag and top5_author_share on every topic_stats_15m row in [from, to) (whole
 * buckets). Run after the counts of those rows were rewritten, inside the same transaction.
 * - burst_flag: isBurst(items, the 96 prior buckets' items with missing buckets as 0).
 * - top5_author_share: top5Share over the 24h window ending at bucket_start + 15m. Posts with a
 *   NULL author count in the total but never as an author.
 * Returns the number of rows updated.
 */
export async function applyCoordinationColumns(
  tx: Sql,
  range: { from: Date; to: Date },
  cfg: CoordinationConfig,
  unknown: number,
): Promise<number> {
  const { from, to } = range
  type Target = {
    bucket_start: string | Date
    topic_id: string
    entity: string
    lane: string
    items: number
  }
  const targets = await tx<Target[]>`
    select bucket_start, topic_id, entity, lane, items
    from topic_stats_15m
    where bucket_start >= ${from.toISOString()}::timestamptz
      and bucket_start < ${to.toISOString()}::timestamptz`
  if (targets.length === 0) return 0

  const trailing = await trailingItems(tx, from, to)
  const authors = await authorCounts(tx, from, to, unknown)

  // Group targets per key, ascending, so the 24h author window slides instead of being rebuilt.
  const perKey = new Map<Key, Target[]>()
  for (const t of targets) {
    const k = keyOf(t.topic_id, t.entity, t.lane)
    const list = perKey.get(k)
    if (list) list.push(t)
    else perKey.set(k, [t])
  }

  const updates: {
    bucket_start: string
    topic_id: string
    entity: string
    lane: string
    burst: boolean
    share: number | null
  }[] = []
  for (const [k, list] of perKey) {
    list.sort((a, b) => ms(a.bucket_start) - ms(b.bucket_start))
    const items = trailing.get(k) ?? new Map<number, number>()
    const entries = authors.get(k) ?? []
    const window = new Map<string, number>()
    let total = 0
    let lo = 0
    let hi = 0
    for (const t of list) {
      const b = ms(t.bucket_start)
      const prior: number[] = []
      for (let i = 1; i <= TRAILING_BUCKETS; i++) prior.push(items.get(b - i * BUCKET_MS) ?? 0)

      // Window of buckets (b - 24h, b], i.e. posts in [b + 15m - 24h, b + 15m).
      while (hi < entries.length && entries[hi]!.bucket <= b) {
        const e = entries[hi++]!
        total += e.total
        for (const [a, n] of e.byAuthor) window.set(a, (window.get(a) ?? 0) + n)
      }
      while (lo < hi && entries[lo]!.bucket <= b - DAY_MS) {
        const e = entries[lo++]!
        total -= e.total
        for (const [a, n] of e.byAuthor) {
          const left = window.get(a)! - n
          if (left === 0) window.delete(a)
          else window.set(a, left)
        }
      }

      updates.push({
        bucket_start: new Date(b).toISOString(),
        topic_id: t.topic_id,
        entity: t.entity,
        lane: t.lane,
        burst: isBurst(t.items, prior, cfg),
        share: top5Share([...window.values()], total, cfg),
      })
    }
  }

  const res = await tx`
    update topic_stats_15m t
    set burst_flag = v.burst, top5_author_share = v.share
    from jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
      as v(bucket_start timestamptz, topic_id uuid, entity text, lane text, burst boolean,
           share real)
    where t.bucket_start = v.bucket_start and t.topic_id = v.topic_id
      and t.entity = v.entity and t.lane = v.lane`
  return res.count
}

/**
 * Recomputes suspected_coordinated for every existing topic_stats_15m row in a bucket that holds a
 * post flagged at `detectedAt` (posts.coord_detected_at), so a flag raised after its bucket was
 * rolled up shows in the counts within the same run. One UPDATE; returns the rows updated.
 */
export async function refreshSuspectedCounts(h: { sql: Sql }, detectedAt: Date): Promise<number> {
  const res = await h.sql`
    with touched as (
      select distinct date_bin('15 minutes', published_at, timestamptz '2000-01-01 00:00:00+00')
               as b
      from posts
      where coord_detected_at = ${detectedAt.toISOString()}::timestamptz
    ),
    src as (
      select t.b as bucket_start, ec.topic_id, p.lane, ec.entities, p.coord_suspected
      from touched t
      join posts p on p.published_at >= t.b and p.published_at < t.b + interval '15 minutes'
      join effective_classifications ec on ec.post_id = p.id
    ),
    fan as (
      select s.bucket_start, s.topic_id, e.entity, l.lane, s.coord_suspected
      from src s
      cross join lateral (
        select 'all'::text as entity
        union
        select distinct x from unnest(s.entities) as x where x <> 'all'
      ) e
      cross join lateral (values ('all'::text), (s.lane)) as l(lane)
    ),
    agg as (
      select bucket_start, topic_id, entity, lane,
             (count(*) filter (where coord_suspected))::int as n
      from fan
      group by bucket_start, topic_id, entity, lane
    )
    update topic_stats_15m t
    set suspected_coordinated = a.n, updated_at = now()
    from agg a
    where t.bucket_start = a.bucket_start and t.topic_id = a.topic_id
      and t.entity = a.entity and t.lane = a.lane
      and t.suspected_coordinated is distinct from a.n`
  return res.count
}
