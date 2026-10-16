// Suspected coordination for the topic page (06-02): near-duplicate clusters, burst buckets and
// the top-5 author share. Author ids are only counted in SQL; nothing here selects a handle, name
// or id, and the response types have no field for one.
import type { CoordinationBurst, CoordinationCluster, TimelineCoordination } from '@jio/core'
import { iso, msToIso, type ReadCtx, type SliceFilter } from './ctx'
import { BUCKET_MS, WINDOW_BUCKETS, range7d, windowRanges } from './window'

export const MAX_CLUSTERS = 10
export const MAX_BURSTS = 20
export const SAMPLE_CHARS = 140

/** Median with the two middle values averaged; 0 for an empty list (as the worker computes it). */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const xs = [...values].sort((a, b) => a - b)
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2
}

const round2 = (n: number) => Math.round(n * 100) / 100

type ClusterRow = {
  cluster_id: string
  posts: number
  authors: number
  first_ms: number
  last_ms: number
  sample: string | null
}

export async function getTimelineCoordination(
  ctx: ReadCtx,
  topicId: string,
  f: SliceFilter,
): Promise<TimelineCoordination> {
  const { sql, now } = ctx
  const week = range7d(now)
  const { cur } = windowRanges(now)
  const trailingFrom = new Date(week.from.getTime() - WINDOW_BUCKETS * BUCKET_MS)

  const [clusterRows, statRows, top5Rows] = await Promise.all([
    sql<ClusterRow[]>`
      with flagged as (
        select p.id, p.near_dup_cluster_id as cluster_id, p.author_id, p.published_at, p.text
        from posts p
        join effective_classifications ec on ec.post_id = p.id
        where ec.topic_id = ${topicId}
          and p.coord_suspected
          and p.near_dup_cluster_id is not null
          and p.published_at >= ${iso(week.from)}::timestamptz
          and p.published_at < ${iso(week.to)}::timestamptz
          and (${f.lane}::text = 'all' or p.lane = ${f.lane}::text)
          and (${f.entity}::text = 'all' or ${f.entity}::text = any(ec.entities))
      )
      select g.cluster_id, g.posts, g.authors, g.first_ms, g.last_ms,
             (select left(x.text, ${SAMPLE_CHARS}) from flagged x
               where x.cluster_id = g.cluster_id
               order by x.published_at, x.id limit 1) as sample
      from (
        select cluster_id, count(*)::int as posts, count(distinct author_id)::int as authors,
               (extract(epoch from min(published_at)) * 1000)::float8 as first_ms,
               (extract(epoch from max(published_at)) * 1000)::float8 as last_ms
        from flagged
        group by cluster_id
      ) g
      order by g.posts desc, g.last_ms desc, g.cluster_id
      limit ${MAX_CLUSTERS}`,
    sql<{ b_ms: number; items: number; burst: boolean }[]>`
      select (extract(epoch from s.bucket_start) * 1000)::float8 as b_ms, s.items, s.burst_flag as burst
      from topic_stats_15m s
      where s.topic_id = ${topicId} and s.entity = ${f.entity} and s.lane = ${f.lane}
        and s.bucket_start >= ${iso(trailingFrom)}::timestamptz
        and s.bucket_start < ${iso(week.to)}::timestamptz`,
    sql<{ share: number | null }[]>`
      select s.top5_author_share::float8 as share
      from topic_stats_15m s
      where s.topic_id = ${topicId} and s.entity = ${f.entity} and s.lane = ${f.lane}
        and s.bucket_start >= ${iso(cur.from)}::timestamptz
        and s.bucket_start < ${iso(cur.to)}::timestamptz
      order by s.bucket_start desc
      limit 1`,
  ])

  const clusters: CoordinationCluster[] = clusterRows.map((r) => ({
    clusterId: r.cluster_id,
    posts: r.posts,
    authors: r.authors,
    firstAt: msToIso(r.first_ms)!,
    lastAt: msToIso(r.last_ms)!,
    sample: r.sample ?? '',
  }))

  const itemsAt = new Map<number, number>()
  for (const r of statRows) itemsAt.set(Number(r.b_ms), r.items)
  const weekFrom = week.from.getTime()
  const bursts: CoordinationBurst[] = statRows
    .filter((r) => r.burst && Number(r.b_ms) >= weekFrom)
    .map((r) => Number(r.b_ms))
    .sort((a, b) => b - a)
    .slice(0, MAX_BURSTS)
    .map((b) => {
      const prior: number[] = []
      for (let i = 1; i <= WINDOW_BUCKETS; i++) prior.push(itemsAt.get(b - i * BUCKET_MS) ?? 0)
      return {
        bucketStart: msToIso(b)!,
        items: itemsAt.get(b) ?? 0,
        trailingMedian: median(prior),
      }
    })

  const share = top5Rows[0]?.share
  return {
    clusters,
    bursts,
    top5AuthorShare: share == null ? null : round2(Number(share)),
  }
}
