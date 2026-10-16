import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext } from '@jio/core'
import { RateLimitedError, SourceAuthError } from '../breaker'
import { createFakeFetch } from './_fixture'
import redditDefault, { WATCH_SUBREDDITS, buildRedditQuery, createRedditAdapter } from './reddit'

const NOW = new Date('2026-10-16T12:00:00Z')
const SINCE = new Date('2026-10-14T00:00:00Z')
const fx = (name: string) =>
  readFileSync(new URL(`./__fixtures__/reddit/${name}`, import.meta.url), 'utf8')
const reply = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } })

function ctx(over: Partial<FetchContext> = {}): FetchContext {
  return {
    since: SINCE,
    source: DEFAULT_CONFIG.sources.reddit,
    terms: DEFAULT_CONFIG.terms,
    mode: 'live',
    signal: new AbortController().signal,
    creds: { REDDIT_CLIENT_ID: 'cid', REDDIT_CLIENT_SECRET: 'sec' },
    ...over,
  }
}

type Call = { url: string; init: RequestInit }

interface Opts {
  token?: () => Response
  search?: (url: string) => Response
  comments?: (url: string) => Response
}

function reddit(opts: Opts = {}) {
  const calls: Call[] = []
  const f = createFakeFetch([
    [
      /www\.reddit\.com\/api\/v1\/access_token/,
      (url, init) => {
        calls.push({ url, init: init ?? {} })
        return opts.token ? opts.token() : reply(fx('token.json'))
      },
    ],
    [
      /oauth\.reddit\.com\/.*search/,
      (url, init) => {
        calls.push({ url, init: init ?? {} })
        if (opts.search) return opts.search(url)
        return reply(
          fx(url.includes('restrict_sr=1') ? 'search-subreddit.json' : 'search-global.json'),
        )
      },
    ],
    [
      /oauth\.reddit\.com\/comments\//,
      (url, init) => {
        calls.push({ url, init: init ?? {} })
        return opts.comments ? opts.comments(url) : reply(fx('comments.json'))
      },
    ],
  ])
  return { calls, f }
}

const tokenCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('access_token'))
const searchCalls = (calls: Call[]) => calls.filter((c) => /\/search\?/.test(c.url))
const commentCalls = (calls: Call[]) => calls.filter((c) => c.url.includes('/comments/'))

afterEach(() => vi.unstubAllGlobals())

describe('reddit adapter', () => {
  it('keeps the stub identity', () => {
    expect(redditDefault.key).toBe('reddit')
    expect(redditDefault.lane).toBe('social')
    expect(redditDefault.requiredCreds).toEqual(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'])
  })

  it('requests a client_credentials token with basic auth', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    const t = tokenCalls(r.calls)[0]!
    expect(t.init.method).toBe('POST')
    const h = t.init.headers as Record<string, string>
    expect(h.Authorization).toBe(`Basic ${Buffer.from('cid:sec').toString('base64')}`)
    expect(String(t.init.body)).toContain('grant_type=client_credentials')
    expect(h['User-Agent']).toContain('jio-ipo-analysis/0.1')
  })

  it('caches the token across runs and refreshes it within 60s of expiry', async () => {
    let t = NOW
    const r = reddit({ token: () => reply('{"access_token":"tok","expires_in":3600}') })
    vi.stubGlobal('fetch', r.f)
    const adapter = createRedditAdapter({ now: () => t })
    await adapter.fetch(ctx())
    await adapter.fetch(ctx())
    expect(tokenCalls(r.calls)).toHaveLength(1)
    t = new Date(NOW.getTime() + 3600_000 - 30_000)
    await adapter.fetch(ctx())
    expect(tokenCalls(r.calls)).toHaveLength(2)
  })

  it('issues 1 global and 6 restricted searches with the documented params', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    const s = searchCalls(r.calls)
    expect(s).toHaveLength(7)
    const global = s.filter((c) => !c.url.includes('restrict_sr=1'))
    expect(global).toHaveLength(1)
    expect(global[0]!.url).toMatch(/^https:\/\/oauth\.reddit\.com\/search\?/)
    for (const sub of WATCH_SUBREDDITS) {
      expect(s.some((c) => c.url.startsWith(`https://oauth.reddit.com/r/${sub}/search?`))).toBe(
        true,
      )
    }
    for (const c of s) {
      const u = new URL(c.url)
      expect(u.searchParams.get('sort')).toBe('new')
      expect(u.searchParams.get('t')).toBe('week')
      expect(u.searchParams.get('limit')).toBe('100')
      expect(u.searchParams.get('raw_json')).toBe('1')
      const h = c.init.headers as Record<string, string>
      expect(h['User-Agent']).toContain('jio-ipo-analysis/0.1')
      expect(h.Authorization).toBe('Bearer tok-abc')
      expect(c.init.signal).toBeDefined()
    }
  })

  it('dedupes by name and maps posts', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    const res = await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    const posts = res.posts.filter((p) => p.externalId.startsWith('t3_'))
    const ids = posts.map((p) => p.externalId)
    expect(ids.filter((i) => i === 't3_a1')).toHaveLength(1)
    expect(ids).toContain('t3_e1')
    expect(ids).not.toContain('t3_old')
    const a = posts.find((p) => p.externalId === 't3_a1')!
    expect(a.url).toBe(
      'https://www.reddit.com/r/IndianStockMarket/comments/a1/jio_ipo_gmp_discussion/',
    )
    expect(a.text).toBe('Jio IPO GMP discussion\n\nWhat are you all expecting for listing?')
    expect(a.publishedAt.toISOString()).toBe('2026-10-16T08:00:00.000Z')
    expect(a.reachRaw).toEqual({ upvotes: 120, comments: 12 })
    expect(a.author).toEqual({
      platform: 'reddit',
      platformUserId: 't2_maven',
      handle: 'market_maven',
      kind: 'other',
    })
    expect(a.sourceKey).toBe('reddit')
    expect(res.costUsd).toBe(0)
  })

  it('maps a [deleted] author to null', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    const res = await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    expect(res.posts.find((p) => p.externalId === 't3_c1')!.author).toBeNull()
    expect(res.posts.find((p) => p.externalId === 't1_c4')!.author).toBeNull()
  })

  it('fetches comments only for fresh threads with comments, most comments first', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    const cc = commentCalls(r.calls)
    expect(cc.map((c) => new URL(c.url).pathname)).toEqual([
      '/comments/a1',
      '/comments/e1',
      '/comments/b1',
    ])
    const u = new URL(cc[0]!.url)
    expect(u.searchParams.get('sort')).toBe('new')
    expect(u.searchParams.get('limit')).toBe('100')
    expect(u.searchParams.get('depth')).toBe('2')
  })

  it('flattens comments with parentTitle and keeps only those newer than since', async () => {
    const r = reddit()
    vi.stubGlobal('fetch', r.f)
    const res = await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    const c1 = res.posts.find((p) => p.externalId === 't1_c1')!
    expect(c1.text).toBe('GMP is looking strong')
    expect(c1.url).toBe(
      'https://www.reddit.com/r/IndianStockMarket/comments/a1/jio_ipo_gmp_discussion/c1/',
    )
    expect((c1.rawJson as { parentTitle: string }).parentTitle).toBe('Jio IPO GMP discussion')
    expect(c1.reachRaw).toEqual({ upvotes: 5 })
    expect(c1.author).toMatchObject({ platform: 'reddit', platformUserId: 't2_one', kind: 'other' })
    expect(res.posts.some((p) => p.externalId === 't1_c2')).toBe(true) // nested reply
    expect(res.posts.some((p) => p.externalId === 't1_c3')).toBe(false) // older than since
    expect(res.posts.some((p) => p.externalId === 't1_c5')).toBe(false) // [removed]
  })

  it('never exceeds 18 requests and 10 comment fetches', async () => {
    const many = {
      kind: 'Listing',
      data: {
        children: Array.from({ length: 15 }, (_, i) => ({
          kind: 't3',
          data: {
            name: `t3_m${i}`,
            id: `m${i}`,
            title: `Jio IPO thread ${i}`,
            selftext: '',
            author: 'u',
            author_fullname: 't2_u',
            permalink: `/r/india/comments/m${i}/x/`,
            created_utc: 1792137600,
            score: 1,
            num_comments: 20 + i,
          },
        })),
      },
    }
    const r = reddit({
      search: (url) =>
        url.includes('restrict_sr=1')
          ? reply('{"data":{"children":[]}}')
          : reply(JSON.stringify(many)),
      comments: () => reply('[{"data":{"children":[]}},{"data":{"children":[]}}]'),
    })
    vi.stubGlobal('fetch', r.f)
    await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    expect(commentCalls(r.calls)).toHaveLength(10)
    expect(r.calls.length).toBeLessThanOrEqual(18)
    expect(r.calls).toHaveLength(18)
  })

  it('stops requesting when x-ratelimit-remaining drops below 5 and returns what it has', async () => {
    const r = reddit({
      search: () => reply(fx('search-global.json'), 200, { 'x-ratelimit-remaining': '3' }),
    })
    vi.stubGlobal('fetch', r.f)
    const res = await createRedditAdapter({ now: () => NOW }).fetch(ctx())
    expect(r.calls).toHaveLength(2) // token + first search
    expect(res.posts.some((p) => p.externalId === 't3_a1')).toBe(true)
  })

  it('maps 429 to RateLimitedError using x-ratelimit-reset', async () => {
    const r = reddit({ search: () => reply('{}', 429, { 'x-ratelimit-reset': '120' }) })
    vi.stubGlobal('fetch', r.f)
    const err = await createRedditAdapter({ now: () => NOW })
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.getTime()).toBe(NOW.getTime() + 120_000)
  })

  it('maps a 401 on the token request to SourceAuthError', async () => {
    const r = reddit({ token: () => reply('{"error":401}', 401) })
    vi.stubGlobal('fetch', r.f)
    await expect(createRedditAdapter({ now: () => NOW }).fetch(ctx())).rejects.toBeInstanceOf(
      SourceAuthError,
    )
  })

  it('serves fixtures with zero network calls in fixture mode', async () => {
    vi.stubGlobal('fetch', createFakeFetch([]))
    const res = await createRedditAdapter({ now: () => NOW }).fetch(ctx({ mode: 'fixture' }))
    expect(res.posts.length).toBeGreaterThan(0)
  })
})

describe('buildRedditQuery', () => {
  it('uses quoted phrases and the guarded jio clause, within 512 chars', () => {
    const q = buildRedditQuery(DEFAULT_CONFIG.terms)
    expect(q.length).toBeLessThanOrEqual(512)
    expect(q).toContain('"Jio IPO"')
    expect(q).toContain('(jio AND (ipo OR gmp OR allotment OR listing))')
  })

  it('never emits bare jio as a standalone term', () => {
    const q = buildRedditQuery(DEFAULT_CONFIG.terms)
    const withoutGuard = q.replace('(jio AND (ipo OR gmp OR allotment OR listing))', '')
    expect(withoutGuard.replace(/"[^"]*"/g, '')).not.toMatch(/jio/i)
    expect(q.split(' OR ')).not.toContain('jio')
  })

  it('truncates a huge term list at 512 chars without breaking the guard clause', () => {
    const terms = structuredClone(DEFAULT_CONFIG.terms)
    terms.ipo_terms = Array.from({ length: 200 }, (_, i) => `Jio Platforms IPO variant number ${i}`)
    const q = buildRedditQuery(terms)
    expect(q.length).toBeLessThanOrEqual(512)
    expect(q).toContain('(jio AND (ipo OR gmp OR allotment OR listing))')
  })
})
