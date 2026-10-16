import { describe, expect, it, vi } from 'vitest'
import { SEED_TOPICS } from '@jio/core'
import type { TopicDef } from '@jio/core'
import { classifyInBatches, planBatches } from './batch'
import type { ClassificationCache, ClassifyItem } from './batch'
import type { Classifier, ClassifierInput, ClassifyResult } from './classifier'

describe('planBatches', () => {
  it.each([
    [0, []],
    [7, [7]],
    [50, [50]],
    [51, [26, 25]],
    [100, [50, 50]],
    [101, [34, 34, 33]],
    [120, [40, 40, 40]],
  ])('splits %i into %j', (n, sizes) => {
    expect(planBatches(n)).toEqual(sizes)
  })

  it('keeps every batch between min and max for large inputs', () => {
    for (let n = 51; n < 1000; n += 7) {
      const sizes = planBatches(n)
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(n)
      for (const s of sizes) {
        expect(s).toBeGreaterThanOrEqual(20)
        expect(s).toBeLessThanOrEqual(50)
      }
    }
  })

  it('honours a custom max', () => {
    expect(planBatches(10, { max: 4 })).toEqual([4, 3, 3])
  })
})

function label(item: ClassifierInput): ClassifyResult {
  return {
    postId: item.postId,
    topicSlug: 'gmp-grey-market',
    sentiment: 'neutral',
    entities: ['jio'],
    confidence: 'high',
    glossEn: `gloss:${item.text}`,
  }
}

function spyClassifier(opts: { failOnCall?: number; delayMs?: number } = {}) {
  let calls = 0
  let inFlight = 0
  let maxInFlight = 0
  const batches: ClassifierInput[][] = []
  const classifier: Classifier = {
    model: 'spy',
    promptVersion: 'spy-v1',
    classify: vi.fn(async (items: ClassifierInput[], _topics: TopicDef[]) => {
      const call = ++calls
      batches.push(items)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 1))
        if (opts.failOnCall === call) throw new Error('batch exploded')
        return items.map(label)
      } finally {
        inFlight--
      }
    }),
  }
  return { classifier, batches, maxInFlight: () => maxInFlight }
}

const items = (n: number, hash = (i: number) => `h${i}`): ClassifyItem[] =>
  Array.from({ length: n }, (_, i) => ({
    postId: `post-${i}`,
    text: `text ${hash(i)}`,
    lang: 'en',
    contentHash: hash(i),
  }))

describe('classifyInBatches', () => {
  it('sends 120 unique items as three batches of 40', async () => {
    const spy = spyClassifier()
    const out = await classifyInBatches(items(120), SEED_TOPICS, { classifier: spy.classifier })
    expect(spy.batches.map((b) => b.length)).toEqual([40, 40, 40])
    expect(out.batches).toBe(3)
    expect(out.results).toHaveLength(120)
    expect(out.failedPostIds).toEqual([])
    expect(out.cacheHits).toBe(0)
    expect(out.results.map((r) => r.postId)).toEqual(items(120).map((i) => i.postId))
  })

  it('classifies one representative per content hash and copies the label to duplicates', async () => {
    const spy = spyClassifier()
    const input = items(10, (i) => `h${i % 2}`)
    const out = await classifyInBatches(input, SEED_TOPICS, { classifier: spy.classifier })
    expect(spy.batches).toHaveLength(1)
    expect(spy.batches[0]!.map((b) => b.postId)).toEqual(['post-0', 'post-1'])
    expect(out.results).toHaveLength(10)
    expect(out.results.map((r) => r.postId)).toEqual(input.map((i) => i.postId))
    expect(out.results[4]).toEqual({ ...label(input[0]!), postId: 'post-4' })
    expect(out.results[7]!.glossEn).toBe('gloss:text h1')
  })

  it('serves cache hits without a model call and fans them out to every post with the hash', async () => {
    const spy = spyClassifier()
    const cached: Omit<ClassifyResult, 'postId'> = {
      topicSlug: 'valuation-price-band',
      sentiment: 'negative',
      entities: [],
      confidence: 'high',
      glossEn: null,
    }
    const get = vi.fn(async (hashes: string[]) => {
      const m = new Map<string, Omit<ClassifyResult, 'postId'>>()
      for (const h of hashes) if (['h0', 'h1', 'h2', 'h3', 'h4'].includes(h)) m.set(h, cached)
      return m
    })
    const cache: ClassificationCache = { get }
    const input = [
      ...items(10),
      { postId: 'dup-of-h0', text: 'x', lang: 'en' as const, contentHash: 'h0' },
    ]
    const out = await classifyInBatches(input, SEED_TOPICS, { classifier: spy.classifier, cache })

    expect(get).toHaveBeenCalledTimes(1)
    expect(new Set(get.mock.calls[0]![0])).toEqual(new Set(input.map((i) => i.contentHash)))
    const sent = spy.batches.flat().map((b) => b.postId)
    expect(sent).toEqual(['post-5', 'post-6', 'post-7', 'post-8', 'post-9'])
    expect(out.cacheHits).toBe(6)
    expect(out.results).toHaveLength(11)
    expect(out.results.find((r) => r.postId === 'dup-of-h0')).toEqual({
      ...cached,
      postId: 'dup-of-h0',
    })
    expect(out.results.find((r) => r.postId === 'post-3')!.topicSlug).toBe('valuation-price-band')
  })

  it('isolates a throwing batch: its posts and their duplicates fail, the rest succeed', async () => {
    const spy = spyClassifier({ failOnCall: 2 })
    const log = { warn: vi.fn() }
    const input = items(120)
    const second = input.slice(40, 80)
    const dup = { postId: 'dup-of-h50', text: 'x', lang: 'en' as const, contentHash: 'h50' }
    const out = await classifyInBatches([...input, dup], SEED_TOPICS, {
      classifier: spy.classifier,
      concurrency: 1,
      log,
    })
    expect(spy.batches.map((b) => b.length)).toEqual([40, 40, 40])
    expect(out.failedPostIds.sort()).toEqual([...second.map((i) => i.postId), 'dup-of-h50'].sort())
    expect(out.results).toHaveLength(80)
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('never runs more than `concurrency` batches at once', async () => {
    const spy = spyClassifier({ delayMs: 5 })
    const out = await classifyInBatches(items(250), SEED_TOPICS, { classifier: spy.classifier })
    expect(out.batches).toBe(5)
    expect(spy.maxInFlight()).toBe(2)

    const spy3 = spyClassifier({ delayMs: 5 })
    await classifyInBatches(items(250), SEED_TOPICS, {
      classifier: spy3.classifier,
      concurrency: 3,
    })
    expect(spy3.maxInFlight()).toBe(3)
  })

  it('marks posts the classifier left out as failed', async () => {
    const classifier: Classifier = {
      model: 'm',
      promptVersion: 'v',
      classify: async (batch) => batch.slice(1).map(label),
    }
    const out = await classifyInBatches(items(3), SEED_TOPICS, { classifier })
    expect(out.failedPostIds).toEqual(['post-0'])
    expect(out.results.map((r) => r.postId)).toEqual(['post-1', 'post-2'])
  })

  it('accounts for every input postId exactly once', async () => {
    const spy = spyClassifier({ failOnCall: 1 })
    const input = items(130, (i) => `h${i % 90}`)
    const out = await classifyInBatches(input, SEED_TOPICS, { classifier: spy.classifier })
    const seen = [...out.results.map((r) => r.postId), ...out.failedPostIds].sort()
    expect(seen).toEqual(input.map((i) => i.postId).sort())
  })

  it('does nothing for no items', async () => {
    const spy = spyClassifier()
    const get = vi.fn()
    const out = await classifyInBatches([], SEED_TOPICS, {
      classifier: spy.classifier,
      cache: { get },
    })
    expect(out).toEqual({ results: [], cacheHits: 0, batches: 0, failedPostIds: [] })
    expect(get).not.toHaveBeenCalled()
  })
})
