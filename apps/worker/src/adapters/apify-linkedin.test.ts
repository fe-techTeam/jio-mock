import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext } from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { createFakeFetch } from './_fixture'
import dataset from './__fixtures__/apify-linkedin/dataset.json'
import linkedin, {
  LINKEDIN_ACTOR,
  MAX_ITEMS_PER_RUN,
  createApifyLinkedinAdapter,
} from './apify-linkedin'
import type { ApifyLike } from './x-apify'

type Input = { postedLimit: string }

function fakeClient(items: unknown[], usageTotalUsd = 0.2) {
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

const NOW = new Date('2026-10-16T12:00:00.000Z')

const ctx = (over: Partial<FetchContext> = {}): FetchContext => ({
  since: new Date('2026-10-14T00:00:00.000Z'),
  source: DEFAULT_CONFIG.sources.apify_linkedin,
  terms: DEFAULT_CONFIG.terms,
  mode: 'live',
  signal: new AbortController().signal,
  creds: { APIFY_TOKEN: 'tok' },
  ...over,
})

describe('apify_linkedin adapter', () => {
  const factory = vi.fn()
  beforeEach(() => {
    factory.mockReset()
    vi.stubGlobal('fetch', createFakeFetch([]))
  })
  afterEach(() => vi.unstubAllGlobals())

  const make = (items: unknown[] = dataset.items) => {
    const f = fakeClient(items)
    factory.mockReturnValue(f.client)
    return { ...f, adapter: createApifyLinkedinAdapter({ apify: factory, now: () => NOW }) }
  }

  it('keeps the stub identity', () => {
    expect(linkedin.key).toBe('apify_linkedin')
    expect(linkedin.lane).toBe('social')
    expect(linkedin.requiredCreds).toEqual(['APIFY_TOKEN'])
  })

  it('sends the actor id, search queries and a week window for an old since', async () => {
    const { adapter, calls } = make()
    await adapter.fetch(ctx())
    expect(LINKEDIN_ACTOR).toBe('harvestapi/linkedin-post-search')
    const { actorId, input } = calls.start[0]!
    expect(actorId).toBe(LINKEDIN_ACTOR)
    expect(input).toEqual({
      searchQueries: [
        '"Jio IPO"',
        '"Jio Platforms IPO"',
        '"Reliance Jio IPO"',
        '"Mukesh Ambani" IPO',
        '"Akash Ambani" Jio',
        '"Isha Ambani" Jio',
      ],
      maxPosts: 50,
      postedLimit: 'week',
    })
  })

  it('uses a 24h window when since is within the last day', async () => {
    const { adapter, calls } = make()
    await adapter.fetch(ctx({ since: new Date(NOW.getTime() - 2 * 3_600_000) }))
    expect(calls.start[0]!.input.postedLimit).toBe('24h')
  })

  it('maps posts across spellings and date formats, dropping old and malformed items', async () => {
    const { adapter, calls } = make()
    const res = await adapter.fetch(ctx())
    expect(calls.limit).toEqual([MAX_ITEMS_PER_RUN])
    expect(res.posts.map((p) => p.externalId)).toEqual([
      'li1',
      'urn:li:activity:2002',
      'li3',
      'li4',
      'li5',
      'li6',
      'li7',
      'li8',
    ])
    expect(res.costUsd).toBe(0.2)
    const [p1, p2, p3] = res.posts
    expect(p1!.sourceKey).toBe('apify_linkedin')
    expect(p1!.url).toContain('linkedin.com/posts/economic-times')
    expect(p1!.publishedAt.toISOString()).toBe('2026-10-15T08:00:00.000Z')
    expect(p1!.reachRaw).toEqual({ likes: 300, comments: 20, shares: 15, followers: 4000000 })
    expect(p2!.text).toContain('Groww')
    expect(p2!.publishedAt.toISOString()).toBe('2026-10-15T08:00:00.000Z')
    expect(p2!.reachRaw.likes).toBe(80)
    expect(p3!.text).toContain('valuation')
    expect(p3!.publishedAt.toISOString()).toBe('2026-10-15T10:00:00.000Z')
  })

  it('classifies media companies by name and everyone else as other', async () => {
    const { adapter } = make()
    const res = await adapter.fetch(ctx())
    expect(res.posts.map((p) => p.author?.kind)).toEqual([
      'media_outlet',
      'media_outlet',
      'other',
      'other',
      'other',
      'media_outlet',
      undefined,
      'media_outlet',
    ])
    expect(res.posts[6]!.author).toBeNull()
  })

  it('marks every post sampled', async () => {
    const { adapter } = make()
    for (const p of (await adapter.fetch(ctx())).posts) {
      expect((p.rawJson as { sampled: boolean }).sampled).toBe(true)
    }
  })

  it('never returns more than MAX_ITEMS_PER_RUN posts', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: `m${i}`,
      url: `https://www.linkedin.com/posts/m${i}`,
      text: `Jio IPO ${i}`,
      postedAt: '2026-10-15T08:00:00.000Z',
    }))
    const { adapter } = make(many)
    expect(MAX_ITEMS_PER_RUN).toBe(100)
    expect((await adapter.fetch(ctx())).posts).toHaveLength(100)
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
