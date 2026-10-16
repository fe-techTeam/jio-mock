// Suspected-coordination heuristics (06-02). Nothing here accuses anyone: the board shows these
// only as "suspected" counts. Author ids stay inside the worker; only flags, counts and shares are
// stored.
//
// - Near-duplicate coordination: a near-duplicate cluster (03-01, cosine >= 0.95) in which
//   nearDupMinAuthors or more distinct social authors post within nearDupWindowMin minutes. Every
//   post in such a window gets posts.coord_suspected = true (monotonic, never reset).
// - Burst: a 15-minute bucket above burstMultiplier x the median of the 96 prior buckets, with at
//   least burstMinItems items.
// - Top-5 author share: the 5 most active authors' share of a slice's 24h posts.
import type { Lane } from '@jio/core'
import type { Sql } from '../triage/repo'
import type { CoordinationConfig } from './config'

export type CoordinationPost<Id extends string = string> = {
  id: Id
  clusterId: string
  authorId: string | null
  lane: Lane
  publishedAt: Date
}

/** How far back detectNearDupCoordination looks (24h board window plus slack for late posts). */
export const COORDINATION_LOOKBACK_MS = 26 * 3_600_000

/**
 * Ids of posts in a near-duplicate cluster window that holds nearDupMinAuthors or more distinct
 * non-null social authors within nearDupWindowMin minutes (inclusive). Media-lane posts are
 * removed before counting (wire-copy syndication across outlets is not coordination) and are never
 * flagged. Null authors never count, but a null-author post inside a qualifying window is flagged.
 */
export function findCoordinatedPosts<Id extends string>(
  posts: CoordinationPost<Id>[],
  cfg: Pick<CoordinationConfig, 'nearDupMinAuthors' | 'nearDupWindowMin'>,
): Set<Id> {
  const windowMs = cfg.nearDupWindowMin * 60_000
  const byCluster = new Map<string, CoordinationPost<Id>[]>()
  for (const p of posts) {
    if (p.lane === 'media') continue
    const list = byCluster.get(p.clusterId)
    if (list) list.push(p)
    else byCluster.set(p.clusterId, [p])
  }

  const flagged = new Set<Id>()
  for (const list of byCluster.values()) {
    list.sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
    const authors = new Map<string, number>()
    let left = 0
    for (let right = 0; right < list.length; right++) {
      const cur = list[right]!
      if (cur.authorId) authors.set(cur.authorId, (authors.get(cur.authorId) ?? 0) + 1)
      const end = cur.publishedAt.getTime()
      while (end - list[left]!.publishedAt.getTime() > windowMs) {
        const gone = list[left]!.authorId
        if (gone) {
          const n = authors.get(gone)! - 1
          if (n === 0) authors.delete(gone)
          else authors.set(gone, n)
        }
        left++
      }
      if (authors.size >= cfg.nearDupMinAuthors) {
        for (let i = left; i <= right; i++) flagged.add(list[i]!.id)
      }
    }
  }
  return flagged
}

/** Median with the two middle values averaged; 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const xs = [...values].sort((a, b) => a - b)
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2
}

/**
 * `trailing` is the counts of the 96 prior buckets (missing buckets as 0). A burst is strictly
 * above burstMultiplier x their median and at least burstMinItems, so a zero median does not flag
 * every busy quarter hour.
 */
export function isBurst(
  items: number,
  trailing: number[],
  cfg: Pick<CoordinationConfig, 'burstMultiplier' | 'burstMinItems'>,
): boolean {
  return items > cfg.burstMultiplier * median(trailing) && items >= cfg.burstMinItems
}

/**
 * The 5 largest per-author counts over `total` (which also counts posts with no author), rounded to
 * 2 dp; null when total is below top5MinItems.
 */
export function top5Share(
  postsPerAuthor: number[],
  total: number,
  cfg: Pick<CoordinationConfig, 'top5MinItems'>,
): number | null {
  if (total < cfg.top5MinItems || total <= 0) return null
  const top = [...postsPerAuthor]
    .sort((a, b) => b - a)
    .slice(0, 5)
    .reduce((s, n) => s + n, 0)
  return Math.round((Math.min(top, total) / total) * 100) / 100
}

/**
 * Loads social posts with a near-duplicate cluster published in the last 26h, applies
 * findCoordinatedPosts and sets coord_suspected = true, coord_detected_at = now on the posts that
 * were not flagged yet. The flag is monotonic: it is never reset to false, and an already flagged
 * post keeps its first coord_detected_at. Returns the number of newly flagged posts.
 */
export async function detectNearDupCoordination(
  h: { sql: Sql },
  now: Date,
  cfg: Pick<CoordinationConfig, 'nearDupMinAuthors' | 'nearDupWindowMin'>,
): Promise<{ flagged: number }> {
  const since = new Date(now.getTime() - COORDINATION_LOOKBACK_MS)
  const rows = await h.sql<
    {
      id: string
      cluster_id: string
      author_id: string | null
      lane: Lane
      published_at: string | Date
    }[]
  >`
    select p.id, p.near_dup_cluster_id as cluster_id, p.author_id::text as author_id, p.lane,
           p.published_at
    from posts p
    where p.lane = 'social'
      and p.near_dup_cluster_id is not null
      and p.published_at >= ${since.toISOString()}::timestamptz`
  const ids = findCoordinatedPosts(
    rows.map((r) => ({
      id: r.id,
      clusterId: r.cluster_id,
      authorId: r.author_id,
      lane: r.lane,
      publishedAt: new Date(r.published_at),
    })),
    cfg,
  )
  if (ids.size === 0) return { flagged: 0 }
  const res = await h.sql`
    update posts
    set coord_suspected = true, coord_detected_at = ${now.toISOString()}::timestamptz
    where id = any(${h.sql.array([...ids])}::uuid[]) and not coord_suspected`
  return { flagged: res.count }
}
