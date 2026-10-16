// Stage one of the two-stage classifier: every ingested post is triaged before any LLM sees it.
// 03-03 calls triagePosts from the classify-batch job; 06-02 reads posts.near_dup_cluster_id.
import type { TermsConfig } from '@jio/core'
import type { Db } from '@jio/db'
import type { Embedder } from '../classify/embedder'
import { contentHash } from './hash'
import { detectLang } from './lang'
import { assignNearDup, type DbNeighbor } from './near-dup'
import { assessRelevance } from './relevance'
import { findNeighbors, selectUntriaged, writeTriage, type Sql, type TriageRow } from './repo'
import { isZeroVector } from './vector'

export { detectLang, HINGLISH_MARKERS } from './lang'
export { contentHash, normalizeForHash } from './hash'
export { assessRelevance, type Relevance, type RelevanceReason } from './relevance'
export { centroid, cosine, l2normalize, toPgVector } from './vector'
export {
  assignNearDup,
  NEAR_DUP_COSINE,
  NEIGHBOR_WINDOW_HOURS,
  type DbNeighbor,
  type NearDupItem,
} from './near-dup'

export type TriageStats = {
  scanned: number
  relevant: number
  dropped: number
  /** Relevant posts that got a stored (non-zero) embedding. */
  embedded: number
  /** Posts in this batch that ended up in a near-duplicate cluster. */
  clustered: number
  embedCostUsd: number
}

export type TriageOptions = {
  embedder: Embedder
  terms: TermsConfig
  /** Posts per pass (default 500). */
  limit?: number
  log?: (msg: string, data?: object) => void
}

export const DEFAULT_TRIAGE_LIMIT = 500

/**
 * Triage up to `limit` untriaged posts (lang IS NULL): language, content hash, keyword relevance;
 * relevant posts are embedded in one call and near-duplicate clustered. Dropped posts keep
 * matched_terms '{}' and no embedding. If the embedder throws, relevant posts are still written
 * (without embedding or cluster) so they can be classified.
 */
export async function triagePosts(
  h: { db: Db; sql: Sql },
  opts: TriageOptions,
): Promise<TriageStats> {
  const log = opts.log ?? (() => {})
  const posts = await selectUntriaged(h.sql, opts.limit ?? DEFAULT_TRIAGE_LIMIT)
  const stats: TriageStats = {
    scanned: posts.length,
    relevant: 0,
    dropped: 0,
    embedded: 0,
    clustered: 0,
    embedCostUsd: 0,
  }
  if (posts.length === 0) return stats

  const rows: TriageRow[] = posts.map((p) => {
    const rel = assessRelevance(p.text, opts.terms)
    if (rel.relevant) stats.relevant++
    else stats.dropped++
    return {
      id: p.id,
      lang: detectLang(p.text),
      contentHash: contentHash(p.text),
      matchedTerms: rel.relevant ? rel.matchedTerms : [],
      embedding: null,
      nearDupClusterId: null,
    }
  })

  const relevantIdx = rows.flatMap((r, i) => (r.matchedTerms.length > 0 ? [i] : []))
  let neighborUpdates: { id: string; clusterId: string }[] = []
  if (relevantIdx.length > 0) {
    let vectors: number[][] | null = null
    try {
      const out = await opts.embedder.embed(relevantIdx.map((i) => posts[i]!.text))
      if (out.vectors.length !== relevantIdx.length) {
        throw new Error(`embedder returned ${out.vectors.length} vectors for ${relevantIdx.length}`)
      }
      vectors = out.vectors
      stats.embedCostUsd = out.costUsd
    } catch (e) {
      log('triage: embedding failed; posts stored without embeddings', {
        model: opts.embedder.model,
        count: relevantIdx.length,
        error: e instanceof Error ? e.message : String(e),
      })
    }

    if (vectors) {
      const items = relevantIdx.flatMap((i, j) => {
        const v = vectors[j]!
        if (v.length !== opts.embedder.dims || isZeroVector(v)) return []
        rows[i]!.embedding = v
        return [{ id: rows[i]!.id, publishedAt: posts[i]!.publishedAt, vector: v }]
      })
      stats.embedded = items.length

      const batchIds = posts.map((p) => p.id)
      const neighbors = new Map<string, DbNeighbor[]>()
      for (const it of items) {
        neighbors.set(it.id, await findNeighbors(h.sql, it.vector, it.publishedAt, batchIds))
      }
      const nd = assignNearDup(items, neighbors)
      neighborUpdates = nd.neighborUpdates
      const byId = new Map(rows.map((r) => [r.id, r]))
      for (const [id, cluster] of nd.clusterOf) byId.get(id)!.nearDupClusterId = cluster
      stats.clustered = nd.clusterOf.size
    }
  }

  await writeTriage(h.sql, rows, neighborUpdates)
  log('triage: pass complete', stats)
  return stats
}
