// The classify-batch job body: triage new posts, then label pending relevant posts (cache first,
// then the classifier) and store one origin='model' classification row per labelled post. Posts
// whose batch failed get no row and are picked up again on the next tick.
import { ENTITY_KEYS, normalizeForMatch, type EntityKey, type TermsConfig } from '@jio/core'
import { getLatestConfig, schema } from '@jio/db'
import { classifyInBatches } from '../classify/batch'
import { EMERGING_SLUG, UNCLASSIFIED_SLUG, type ClassifyResult } from '../classify/classifier'
import { triagePosts, type TriageStats } from '../triage'
import { dbClassificationCache, loadClassifierTopics, pendingPosts, topicIdsBySlug } from './db'
import type { PipelineDeps, PipelineHandle, UsageTotals } from './deps'

export const DEFAULT_CLASSIFY_LIMIT = 200
export const DEFAULT_TRIAGE_LIMIT = 500

export type ClassifyStepResult = {
  triage: TriageStats
  pending: number
  classified: number
  cacheHits: number
  failed: number
  usage?: UsageTotals
}

/** Entity keys whose configured aliases appear among a post's matched terms. */
export function entitiesFromMatchedTerms(matched: string[], terms: TermsConfig): EntityKey[] {
  const hits = new Set(matched.map((m) => normalizeForMatch(m)))
  return ENTITY_KEYS.filter((key) =>
    terms.entities[key].aliases.some((a) => hits.has(normalizeForMatch(a))),
  )
}

function unionEntities(a: EntityKey[], b: EntityKey[]): EntityKey[] {
  const set = new Set([...a, ...b])
  return ENTITY_KEYS.filter((k) => set.has(k))
}

export async function runClassifyBatch(
  h: PipelineHandle,
  deps: PipelineDeps,
  opts: { now?: Date; triageLimit?: number; limit?: number } = {},
): Promise<ClassifyStepResult> {
  const now = opts.now ?? new Date()
  const { config } = await getLatestConfig(h.db)
  const terms = config.terms

  const triage = await triagePosts(h, {
    embedder: deps.embedder,
    terms,
    limit: opts.triageLimit ?? DEFAULT_TRIAGE_LIMIT,
    log: (msg, data) => deps.log.info(data ?? {}, msg),
  })

  const pending = await pendingPosts(h, opts.limit ?? DEFAULT_CLASSIFY_LIMIT)
  const result: ClassifyStepResult = {
    triage,
    pending: pending.length,
    classified: 0,
    cacheHits: 0,
    failed: 0,
  }
  if (pending.length > 0) {
    const topics = await loadClassifierTopics(h)
    const cache = dbClassificationCache(h)
    const out = await classifyInBatches(pending, topics, {
      classifier: deps.classifier,
      cache,
      log: deps.log,
    })

    const ids = await topicIdsBySlug(h)
    const unclassifiedId = ids.get(UNCLASSIFIED_SLUG)
    if (!unclassifiedId) throw new Error('topic "unclassified" is missing: run pnpm db:seed')
    const byId = new Map(pending.map((p) => [p.postId, p]))

    const rows = out.results.map((r: ClassifyResult) => {
      const p = byId.get(r.postId)!
      const known = r.topicSlug !== UNCLASSIFIED_SLUG && r.topicSlug !== EMERGING_SLUG
      const topicId = known ? ids.get(r.topicSlug) : undefined
      const src = cache.sources.get(p.contentHash)
      return {
        postId: r.postId,
        origin: 'model' as const,
        topicId: topicId ?? unclassifiedId,
        sentiment: r.sentiment,
        entities: unionEntities(r.entities, entitiesFromMatchedTerms(p.matchedTerms, terms)),
        confidence: topicId ? r.confidence : ('low' as const),
        glossEn: r.glossEn,
        model: src ? src.model : deps.classifier.model,
        promptVersion: src ? src.promptVersion : deps.classifier.promptVersion,
        createdAt: now,
      }
    })
    if (rows.length > 0) await h.db.insert(schema.classifications).values(rows)

    result.classified = rows.length
    result.cacheHits = out.cacheHits
    result.failed = out.failedPostIds.length
  }

  const usage = deps.usage?.take()
  if (usage && usage.calls > 0) result.usage = usage
  deps.log.info({ ...result }, 'classify-batch run')
  return result
}
