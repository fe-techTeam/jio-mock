// Near-duplicate clustering (brew Assumptions: embedding cosine >= 0.95). Coordination flags
// (06-02) read posts.near_dup_cluster_id; the 5-authors-in-60-minutes rule is applied there.
import { cosine } from './vector'

export const NEAR_DUP_COSINE = 0.95
/** Neighbors are searched within +-48h of an item's published_at. */
export const NEIGHBOR_WINDOW_HOURS = 48
const WINDOW_MS = NEIGHBOR_WINDOW_HOURS * 3_600_000

export type NearDupItem = { id: string; publishedAt: Date; vector: number[] }
/** An already-embedded post found in the database. */
export type DbNeighbor = { id: string; clusterId: string | null; similarity: number }

export type NearDupResult = {
  /** Batch items that belong to a cluster; items without one are absent. */
  clusterOf: Map<string, string>
  /** Database posts that had no cluster and now seed one. */
  neighborUpdates: { id: string; clusterId: string }[]
}

export const clusterIdFor = (seedPostId: string) => `nd_${seedPostId}`

/**
 * Items are processed by publishedAt ascending. Each joins the cluster of its most similar
 * neighbor (a database post, or an earlier item in this batch within the window) at similarity
 * >= NEAR_DUP_COSINE. A neighbor without a cluster seeds a new one, `nd_<neighbor id>`, and gets
 * it too. No qualifying neighbor leaves the item unclustered. Two existing clusters are never
 * merged.
 */
export function assignNearDup(
  items: readonly NearDupItem[],
  neighbors: ReadonlyMap<string, readonly DbNeighbor[]>,
): NearDupResult {
  const sorted = [...items].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime() || a.id.localeCompare(b.id),
  )
  const clusterOf = new Map<string, string>()
  /** Clusters given to database neighbors during this pass. */
  const dbAssigned = new Map<string, string>()
  const neighborUpdates: NearDupResult['neighborUpdates'] = []
  const done: NearDupItem[] = []

  for (const item of sorted) {
    let best: { id: string; similarity: number; inBatch: boolean } | null = null
    for (const n of neighbors.get(item.id) ?? []) {
      if (n.id === item.id) continue
      if (!best || n.similarity > best.similarity) {
        best = { id: n.id, similarity: n.similarity, inBatch: false }
      }
    }
    for (const prev of done) {
      if (Math.abs(item.publishedAt.getTime() - prev.publishedAt.getTime()) > WINDOW_MS) continue
      const similarity = cosine(item.vector, prev.vector)
      if (!best || similarity > best.similarity) {
        best = { id: prev.id, similarity, inBatch: true }
      }
    }
    done.push(item)
    if (!best || best.similarity < NEAR_DUP_COSINE) continue

    let cluster: string
    if (best.inBatch) {
      cluster = clusterOf.get(best.id) ?? clusterIdFor(best.id)
      clusterOf.set(best.id, cluster)
    } else {
      const known =
        dbAssigned.get(best.id) ??
        (neighbors.get(item.id) ?? []).find((n) => n.id === best.id)?.clusterId ??
        null
      if (known) {
        cluster = known
      } else {
        cluster = clusterIdFor(best.id)
        dbAssigned.set(best.id, cluster)
        neighborUpdates.push({ id: best.id, clusterId: cluster })
      }
    }
    clusterOf.set(item.id, cluster)
  }
  return { clusterOf, neighborUpdates }
}
