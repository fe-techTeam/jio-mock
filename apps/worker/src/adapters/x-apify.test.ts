import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext } from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { buildXQueries, xPostUrl } from './x-api'
import { createFakeFetch } from './_fixture'
import dataset from './__fixtures__/x-apify/dataset.json'
import xApify, {
  X_APIFY_ACTOR,
  createXApifyAdapter,
  runApifyActor,
  type ApifyLike,
  type ApifyRunInfo,
} from './x-apify'

const NOW = new Date('2026-10-16T12:00:00.000Z')

interface FakeOpts {
  statuses?: string[]
  items?: unknown[]
  usageTotalUsd?: number
  hang?: boolean
}

function fakeApify(o: FakeOpts = {}) {
  const calls = {
    start: [] as { actorId: string; input: unknown }[],
    wait: 0,
    abort: 0,
    listItems: [] as unknown[],
  }
  const statuses = [...(o.statuses ?? ['SUCCEEDED'])]
  const run = (status: string): ApifyRunInfo => ({
    id: 'run1',
    status,
    defaultDatasetId: 'ds1',
    ...(o.usageTotalUsd !== undefined ? { usageTotalUsd: o.usageTotalUsd } : {}),
  })
  const client: ApifyLike = {
    actor: (actorId) => ({
      start: async (input) => {
        calls.start.push({ actorId, input })
        return run('READY')
      },
    }),
    run: () => ({
      waitForFinish: async () => {
        calls.wait++
        if (o.hang) return new Promise<ApifyRunInfo>(() => {})
        const s = statuses.length > 1 ? statuses.shift()! : statuses[0]!
        return run(s)
      },
      get: async () => run('SUCCEEDED'),
      abort: async () => {
        calls.abort++
      },
    }),
    dataset: () => ({
      listItems: async (opts) => {
        calls.listItems.push(opts)
        return { items: o.items ?? [] }
      },
    }),
  }
  return { client, calls }
}

const signal = () => new AbortController().signal

describe('runApifyActor', () => {
  const base = { actorId: 'a/b', input: { q: 1 }, maxItems: 7 }

  it('starts, waits, lists items with limit and reports usageTotalUsd', async () => {
    const { client, calls } = fakeApify({ items: [{ a: 1 }], usageTotalUsd: 0.42 })
    const res = await runApifyActor(client, { ...base, signal: signal() })
    expect(calls.start).toEqual([{ actorId: 'a/b', input: { q: 1 } }])
    expect(calls.listItems).toEqual([{ limit: 7 }])
    expect(res).toEqual({ items: [{ a: 1 }], costUsd: 0.42, runId: 'run1' })
  })

  it('costs 0 when usageTotalUsd is absent', async () => {
    const { client } = fakeApify()
    const res = await runApifyActor(client, { ...base, signal: signal() })
    expect(res.costUsd).toBe(0)
  })

  it('polls in slices until the run finishes', async () => {
    const { client, calls } = fakeApify({ statuses: ['RUNNING', 'RUNNING', 'SUCCEEDED'] })
    await runApifyActor(client, { ...base, signal: signal() })
    expect(calls.wait).toBe(3)
  })

  it.each(['FAILED', 'ABORTED', 'TIMED-OUT'])('rejects when the run is %s', async (status) => {
    const { client, calls } = fakeApify({ statuses: [status] })
    await expect(runApifyActor(client, { ...base, signal: signal() })).rejects.toThrow(
      `apify run ${status}: a/b`,
    )
    expect(calls.listItems).toHaveLength(0)
  })

  it('aborts the run when the signal fires mid-wait', async () => {
    const { client, calls } = fakeApify({ hang: true })
    const ac = new AbortController()
    const p = runApifyActor(client, { ...base, signal: ac.signal })
    await new Promise((r) => setTimeout(r, 5))
    ac.abort(new Error('timeout'))
    await expect(p).rejects.toThrow()
    expect(calls.abort).toBe(1)
  })

  it('does not start when the signal is already aborted', async () => {
    const { client, calls } = fakeApify()
    const ac = new AbortController()
    ac.abort()
    await expect(runApifyActor(client, { ...base, signal: ac.signal })).rejects.toThrow()
    expect(calls.start).toHaveLength(0)
  })

  it('aborts and rejects when the run outlives waitSecs', async () => {
    const { client, calls } = fakeApify({ statuses: ['RUNNING'] })
    await expect(
      runApifyActor(client, { ...base, signal: signal(), waitSecs: 120 }),
    ).rejects.toThrow(/did not finish/)
    expect(calls.wait).toBe(2)
    expect(calls.abort).toBe(1)
  })
})

describe('x_apify adapter', () => {
  const factory = vi.fn()
  beforeEach(() => {
    factory.mockReset()
    vi.stubGlobal('fetch', createFakeFetch([]))
  })
  afterEach(() => vi.unstubAllGlobals())

  const ctx = (over: Partial<FetchContext> = {}): FetchContext => ({
    since: new Date('2026-10-14T00:00:00.000Z'),
    source: DEFAULT_CONFIG.sources.x_apify,
    terms: DEFAULT_CONFIG.terms,
    mode: 'live',
    signal: signal(),
    creds: { APIFY_TOKEN: 'apify-secret' },
    ...over,
  })

  const make = (o: FakeOpts = {}) => {
    const fake = fakeApify({ items: dataset.items, usageTotalUsd: 0.31, ...o })
    factory.mockReturnValue(fake.client)
    return { ...fake, adapter: createXApifyAdapter({ apify: factory, now: () => NOW }) }
  }

  it('keeps the stub identity', () => {
    expect(xApify.key).toBe('x_apify')
    expect(xApify.lane).toBe('social')
    expect(xApify.requiredCreds).toEqual(['APIFY_TOKEN'])
  })

  it('runs the actor with queries, Latest sort and the since date', async () => {
    const { adapter, calls } = make()
    await adapter.fetch(ctx())
    expect(factory).toHaveBeenCalledWith('apify-secret')
    expect(calls.start[0]!.actorId).toBe(X_APIFY_ACTOR)
    expect(X_APIFY_ACTOR).toBe('apidojo/tweet-scraper')
    expect(calls.start[0]!.input).toEqual({
      searchTerms: buildXQueries(DEFAULT_CONFIG.terms, { maxLen: 512 }),
      sort: 'Latest',
      maxItems: 200,
      start: '2026-10-14',
    })
    expect(calls.listItems).toEqual([{ limit: 200 }])
  })

  it('maps mixed field spellings, drops old and invalid items, and reports cost', async () => {
    const { adapter } = make()
    const res = await adapter.fetch(ctx())
    expect(res.posts.map((p) => p.externalId)).toEqual([
      '2001',
      '2002',
      '2003',
      '2004',
      '2005',
      '2006',
      '2007',
      '2008',
    ])
    expect(res.costUsd).toBe(0.31)
    const [p1, p2] = res.posts
    expect(p1!.sourceKey).toBe('x_apify')
    expect(p1!.url).toBe('https://x.com/retail_rohan/status/2001')
    expect(p1!.publishedAt.toISOString()).toBe('2026-10-14T10:00:00.000Z')
    expect(p1!.reachRaw).toEqual({
      followers: 310,
      likes: 4,
      retweets: 0,
      replies: 1,
      quotes: 0,
      impressions: 220,
    })
    expect(p2!.text).toContain('allotment date')
    expect(p2!.url).toBe('https://x.com/dalal_street_dev/status/2002')
    expect(res.posts[4]!.url).toBe('https://x.com/gujju_investor/status/2005')
    expect(res.posts[5]!.author?.platformUserId).toBe('9009')
    expect(res.posts[6]!.author).toBeNull()
    expect(res.posts[6]!.url).toBe(xPostUrl(undefined, '2007'))
  })

  it('applies the author-kind rule', async () => {
    const { adapter } = make()
    const kinds = (await adapter.fetch(ctx())).posts.map((p) => p.author?.kind)
    expect(kinds).toEqual([
      'other',
      'other',
      'media_outlet',
      'public_figure',
      'other',
      'other',
      undefined,
      'other',
    ])
  })

  it('counts invalid items on the first post and keeps secrets out of rawJson', async () => {
    const { adapter } = make()
    const res = await adapter.fetch(ctx())
    const raw = res.posts[0]!.rawJson as { dropped: { invalid: number } }
    expect(raw.dropped.invalid).toBe(2)
    expect(JSON.stringify(res.posts.map((p) => p.rawJson))).not.toContain('apify-secret')
  })

  it('propagates a FAILED run', async () => {
    const { adapter } = make({ statuses: ['FAILED'] })
    await expect(adapter.fetch(ctx())).rejects.toThrow('apify run FAILED')
  })

  it('rejects live mode without a token and never builds a client', async () => {
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
