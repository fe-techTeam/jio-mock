// Runs a set of triaged posts through a Classifier: cached labels first (by content hash), then one
// representative per remaining hash, sent in batches of 20-50 through a small promise pool. A batch
// that throws fails only its own posts, which the caller retries on a later tick.
import type { Logger } from 'pino'
import type { Lang, TopicDef } from '@jio/core'
import type { Classifier, ClassifierInput, ClassifyResult } from './classifier'

export type ClassifyItem = { postId: string; text: string; lang: Lang; contentHash: string }

export type CachedLabel = Omit<ClassifyResult, 'postId'>

/** Looks up labels already stored for these content hashes (03-03 backs this with the DB). */
export type ClassificationCache = {
  get(hashes: string[]): Promise<Map<string, CachedLabel>>
}

export type ClassifyBatchesResult = {
  results: ClassifyResult[]
  /** Posts served from the cache, counting every post that shares a cached hash. */
  cacheHits: number
  batches: number
  failedPostIds: string[]
}

export const BATCH_MIN = 20
export const BATCH_MAX = 50

/**
 * Batch sizes for n items: one batch up to `max`, otherwise ceil(n / max) near-equal batches.
 * Near-equal splitting keeps every batch above max / 2, so `min` (<= max / 2) holds by design.
 */
export function planBatches(n: number, opts: { min?: number; max?: number } = {}): number[] {
  const max = Math.max(1, Math.floor(opts.max ?? BATCH_MAX))
  if (n <= 0) return []
  if (n <= max) return [n]
  const k = Math.ceil(n / max)
  const base = Math.floor(n / k)
  const extra = n % k
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0))
}

async function runPool(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!
      await task()
    }
  }
  const width = Math.max(1, Math.min(concurrency, tasks.length))
  await Promise.all(Array.from({ length: width }, worker))
}

export async function classifyInBatches(
  items: ClassifyItem[],
  topics: TopicDef[],
  opts: {
    classifier: Classifier
    cache?: ClassificationCache
    concurrency?: number
    log?: Pick<Logger, 'warn'>
  },
): Promise<ClassifyBatchesResult> {
  if (items.length === 0) return { results: [], cacheHits: 0, batches: 0, failedPostIds: [] }

  // Group posts by content hash, keeping first-seen order.
  const byHash = new Map<string, ClassifyItem[]>()
  for (const item of items) {
    const group = byHash.get(item.contentHash)
    if (group) group.push(item)
    else byHash.set(item.contentHash, [item])
  }

  const labels = new Map<string, CachedLabel>() // contentHash -> label
  const failedHashes = new Set<string>()
  let cacheHits = 0

  // 1) cache lookup
  if (opts.cache) {
    const cached = await opts.cache.get([...byHash.keys()])
    for (const [hash, label] of cached) {
      const group = byHash.get(hash)
      if (!group) continue
      labels.set(hash, label)
      cacheHits += group.length
    }
  }

  // 2) one representative per uncached hash
  const pending: ClassifierInput[] = []
  const hashOfPost = new Map<string, string>()
  for (const [hash, group] of byHash) {
    if (labels.has(hash)) continue
    const rep = group[0]!
    pending.push({ postId: rep.postId, text: rep.text, lang: rep.lang })
    hashOfPost.set(rep.postId, hash)
  }

  // 3) batches through a small pool
  const sizes = planBatches(pending.length)
  const chunks: ClassifierInput[][] = []
  let offset = 0
  for (const size of sizes) {
    chunks.push(pending.slice(offset, offset + size))
    offset += size
  }

  const tasks = chunks.map((chunk, index) => async () => {
    try {
      const out = await opts.classifier.classify(chunk, topics)
      const byPost = new Map(out.map((r) => [r.postId, r]))
      for (const rep of chunk) {
        const hash = hashOfPost.get(rep.postId)!
        const r = byPost.get(rep.postId)
        if (!r) {
          failedHashes.add(hash)
          continue
        }
        labels.set(hash, {
          topicSlug: r.topicSlug,
          sentiment: r.sentiment,
          entities: r.entities,
          confidence: r.confidence,
          glossEn: r.glossEn,
        })
      }
    } catch (err) {
      for (const rep of chunk) failedHashes.add(hashOfPost.get(rep.postId)!)
      opts.log?.warn(
        { err: err instanceof Error ? err.message : String(err), batch: index, size: chunk.length },
        'classify batch failed; its posts will be retried',
      )
    }
  })
  await runPool(tasks, opts.concurrency ?? 2)

  // 4) fan labels out to every post, in input order
  const results: ClassifyResult[] = []
  const failedPostIds: string[] = []
  for (const item of items) {
    const label = labels.get(item.contentHash)
    if (label && !failedHashes.has(item.contentHash))
      results.push({ ...label, postId: item.postId })
    else failedPostIds.push(item.postId)
  }

  return { results, cacheHits, batches: chunks.length, failedPostIds }
}
