import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext } from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { createFakeFetch } from './_fixture'
import dataset from './__fixtures__/apify-instagram/dataset.json'
import instagram, {
  INSTAGRAM_ACTOR,
  MAX_ITEMS_PER_RUN,
  createApifyInstagramAdapter,
} from './apify-instagram'
import type { ApifyLike } from './x-apify'

type Input = { hashtags: string[]; resultsType: string; resultsLimit: number }

function fakeClient(items: unknown[], usageTotalUsd = 0.12) {
  const calls = { start: [] as { actorId: string; input: Input }[], limit: [] as unknown[] }
  const run = { id: 'r1', status: 'SUCCEEDED', defaultDatasetId: 'd1', usageTotalUsd }
  const client: ApifyLike = {
    actor: (actorId) => ({
      start: async (input) => {
        calls.start.push({ actorId, input: input as Input })
        return run
      },
    }),
    run: () => ({ waitForFinish: async () => run, get: async () => run, abort: async () => {} }),
    dataset: () => ({
      listItems: async (o) => {
        calls.limit.push(o?.limit)
        return { items }
      },
    }),
  }
  return { client, calls }
}

const ctx = (over: Partial<FetchContext> = {}): FetchContext => ({
  since: new Date('2026-10-14T00:00:00.000Z'),
  source: DEFAULT_CONFIG.sources.apify_instagram,
  terms: DEFAULT_CONFIG.terms,
  mode: 'live',
  signal: new AbortController().signal,
  creds: { APIFY_TOKEN: 'tok' },
  ...over,
})

describe('apify_instagram adapter', () => {
  const factory = vi.fn()
  beforeEach(() => {
    factory.mockReset()
    vi.stubGlobal('fetch', createFakeFetch([]))
  })
  afterEach(() => vi.unstubAllGlobals())

  const make = (items: unknown[] = dataset.items) => {
    const f = fakeClient(items)
    factory.mockReturnValue(f.client)
    return { ...f, adapter: createApifyInstagramAdapter({ apify: factory }) }
  }

  it('keeps the stub identity', () => {
    expect(instagram.key).toBe('apify_instagram')
    expect(instagram.lane).toBe('social')
    expect(instagram.requiredCreds).toEqual(['APIFY_TOKEN'])
  })

  it('sends the actor id and a capped list of Jio-specific hashtags', async () => {
    const { adapter, calls } = make()
    await adapter.fetch(ctx())
    expect(INSTAGRAM_ACTOR).toBe('apify/instagram-hashtag-scraper')
    const { actorId, input } = calls.start[0]!
    expect(actorId).toBe(INSTAGRAM_ACTOR)
    expect(input.resultsType).toBe('posts')
    expect(input.resultsLimit).toBe(50)
    expect(input.hashtags.length).toBeLessThanOrEqual(8)
    expect(input.hashtags).toContain('JioIPO')
    for (const h of input.hashtags) expect(h.startsWith('#')).toBe(false)
    expect(input.hashtags).not.toContain('IPO')
    expect(input.hashtags).not.toContain('GMP')
  })

  it('maps posts, drops old and malformed items, and reports cost', async () => {
    const { adapter, calls } = make()
    const res = await adapter.fetch(ctx())
    expect(calls.limit).toEqual([MAX_ITEMS_PER_RUN])
    expect(res.posts).toHaveLength(8)
    expect(res.costUsd).toBe(0.12)
    const p = res.posts[0]!
    expect(p.sourceKey).toBe('apify_instagram')
    expect(p.externalId).toBe('Sc0Abc')
    expect(p.url).toBe('https://www.instagram.com/p/Sc0Abc/')
    expect(p.text).toContain('Jio IPO is coming')
    expect(p.text).toContain('#JioIPO')
    expect(p.publishedAt.toISOString()).toBe('2026-10-15T08:00:00.000Z')
    expect(p.author).toMatchObject({
      platform: 'instagram',
      platformUserId: 'o0',
      handle: 'owner_0',
      kind: 'other',
    })
    expect(p.reachRaw).toEqual({ likes: 10, comments: 0, views: 0 })
    expect(res.posts.map((x) => x.externalId)).not.toContain('OldOne1')
  })

  it('marks every post sampled and every author other', async () => {
    const { adapter } = make()
    const res = await adapter.fetch(ctx())
    for (const p of res.posts) {
      expect((p.rawJson as { sampled: boolean }).sampled).toBe(true)
      expect(p.author?.kind).toBe('other')
    }
  })

  it('never returns more than MAX_ITEMS_PER_RUN posts', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      shortCode: `S${i}`,
      caption: `Jio IPO ${i}`,
      timestamp: '2026-10-15T08:00:00.000Z',
    }))
    const { adapter } = make(many)
    const res = await adapter.fetch(ctx())
    expect(MAX_ITEMS_PER_RUN).toBe(100)
    expect(res.posts).toHaveLength(100)
  })

  it('rejects live mode without a token', async () => {
    const { adapter } = make()
    await expect(adapter.fetch(ctx({ creds: {} }))).rejects.toBeInstanceOf(NotConfiguredError)
    expect(factory).not.toHaveBeenCalled()
  })

  it('never calls the factory in fixture mode', async () => {
    const { adapter } = make()
    const res = await adapter.fetch(ctx({ mode: 'fixture', creds: {} }))
    expect(res.posts.length).toBeGreaterThan(0)
    expect(factory).not.toHaveBeenCalled()
  })
})
