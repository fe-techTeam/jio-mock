import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext, type TermsConfig } from '@jio/core'
import { NotConfiguredError, RateLimitedError, SourceAuthError } from '../breaker'
import { createFakeFetch } from './_fixture'
import page1 from './__fixtures__/x-api/page1.json'
import page2 from './__fixtures__/x-api/page2.json'
import xApi, {
  X_COST_PER_POST_USD,
  X_MEDIA_HANDLES,
  buildXQueries,
  createXApiAdapter,
  xAuthorKind,
} from './x-api'

const T = DEFAULT_CONFIG.terms
const TOKEN = 'secret-bearer-token-123'
const NOW = new Date('2026-10-16T12:00:00.000Z')

const smallTerms: TermsConfig = {
  ...T,
  ipo_terms: ['Jio IPO'],
  hashtags: ['#JioIPO'],
  generic_hashtags: ['#IPO'],
  entities: {
    mukesh: { label: 'M', aliases: ['Mukesh Ambani'] },
    akash: { label: 'A', aliases: ['Akash Ambani'] },
    isha: { label: 'I', aliases: ['Isha Ambani'] },
    jio: { label: 'J', aliases: ['Reliance Jio'] },
  },
  cooccurrence_terms: ['IPO', 'GMP'],
}

function ctx(over: Partial<FetchContext> & { tier?: 'pro' | 'basic' } = {}): FetchContext {
  const { tier, ...rest } = over
  return {
    since: new Date('2026-10-16T00:00:00.000Z'),
    source: { ...DEFAULT_CONFIG.sources.x_api, x_tier: tier ?? 'basic' },
    terms: smallTerms,
    mode: 'live',
    signal: new AbortController().signal,
    creds: { X_BEARER_TOKEN: TOKEN },
    ...rest,
  }
}

interface Seen {
  url: URL
  headers: Record<string, string>
}

function serve(seen: Seen[]) {
  return createFakeFetch([
    [
      /api\.x\.com\/2\/tweets\/search\/recent/,
      (url, init) => {
        const u = new URL(url)
        seen.push({ url: u, headers: init?.headers as Record<string, string> })
        const body = u.searchParams.get('next_token') === 'NEXT1' ? page2 : page1
        return new Response(JSON.stringify(body), { status: 200 })
      },
    ],
  ])
}

const adapterWith = (f: typeof fetch) => createXApiAdapter({ fetch: f, now: () => NOW })

beforeEach(() => {
  vi.stubGlobal('fetch', createFakeFetch([]))
})
afterEach(() => vi.unstubAllGlobals())

const count = (queries: string[], re: RegExp) => queries.filter((q) => re.test(q)).length
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('buildXQueries', () => {
  const q512 = buildXQueries(T, { maxLen: 512 })

  it('keeps every query within the tier limit', () => {
    expect(q512.length).toBeGreaterThan(1)
    for (const q of q512) expect(q.length).toBeLessThanOrEqual(512)
    const q4096 = buildXQueries(T, { maxLen: 4096 })
    for (const q of q4096) expect(q.length).toBeLessThanOrEqual(4096)
    expect(q4096.length).toBeLessThan(q512.length)
  })

  it('puts every phrase, alias and hashtag in exactly one query', () => {
    const phrases = new Set(
      [...T.ipo_terms, ...T.hashtags, ...Object.values(T.entities).flatMap((e) => e.aliases)].map(
        (s) => s.toLowerCase(),
      ),
    )
    for (const term of phrases) {
      const needsQuote = /\s|[^ -~]|\./.test(term) && !term.startsWith('#')
      const token = needsQuote ? `"${esc(term)}"` : `(?<![#\\w])${esc(term)}(?!\\w)`
      expect(
        count(
          q512.map((q) => q.toLowerCase()),
          new RegExp(token),
        ),
        term,
      ).toBe(1)
    }
  })

  it('ends every query with -is:retweet', () => {
    for (const q of q512) expect(q.endsWith(' -is:retweet')).toBe(true)
  })

  it('double-quotes multi-word and non-Latin terms', () => {
    const joined = q512.join('\n')
    expect(joined).toContain('"Jio IPO"')
    expect(joined).toContain('"जियो आईपीओ"')
    expect(joined).toContain('"રિલાયન્સ જિયો"')
    expect(joined).not.toMatch(/(^|[ (])जियो आईपीओ($|[ )])/)
  })

  it('never emits a standalone jio or Ambani token outside a co-occurrence group', () => {
    for (const q of q512) {
      const stripped = q
        .replace(/"[^"]*"/g, 'Q')
        .replace(/#\w+/g, 'H')
        .replace(/\((?:Jio|Q|JPL|Ambani) \([^()]*\)\)/gi, 'G')
      expect(stripped).not.toMatch(/(^|[\s(])(jio|जियो|જિયો|ambani)($|[\s)])/i)
    }
  })

  it('keeps generic hashtags only inside a Jio group', () => {
    const joined = q512.join('\n')
    expect(joined).toContain('#GMP')
    for (const tag of T.generic_hashtags) {
      for (const m of joined.matchAll(new RegExp(`(?<!\\w)${esc(tag)}(?!\\w)`, 'g'))) {
        const before = joined.slice(Math.max(0, m.index - 600), m.index).toLowerCase()
        const opens = [...before.matchAll(/\((?:jio|"जियो"|"જિયો"|jpl) \(/g)]
        const open = opens.length > 0 ? opens[opens.length - 1]!.index : -1
        expect(open, tag).toBeGreaterThan(-1)
        expect(before.slice(open)).not.toContain('))')
      }
    }
  })

  it('does not exclude negative terms in the query', () => {
    for (const q of q512) expect(q).not.toMatch(/-"?Jio Financial/i)
  })

  it('includes the Ambani co-occurrence clause', () => {
    expect(q512.join('\n')).toContain('(Ambani (IPO OR Jio))')
  })
})

describe('xAuthorKind', () => {
  it('classifies media handles, verified big accounts and everyone else', () => {
    expect(X_MEDIA_HANDLES).toContain('livemint')
    expect(xAuthorKind({ username: 'LiveMint', followers: 5 })).toBe('media_outlet')
    expect(xAuthorKind({ username: 'a', followers: 100_000, verified: true })).toBe('public_figure')
    expect(xAuthorKind({ username: 'a', followers: 99_999, verifiedType: 'blue' })).toBe('other')
    expect(xAuthorKind({ username: 'a', followers: 500_000, verifiedType: 'none' })).toBe('other')
  })
})

describe('x_api adapter', () => {
  it('keeps the stub identity', () => {
    expect(xApi.key).toBe('x_api')
    expect(xApi.lane).toBe('social')
    expect(xApi.requiredCreds).toEqual(['X_BEARER_TOKEN'])
  })

  it('pages with a bearer header and maps posts', async () => {
    const seen: Seen[] = []
    const res = await adapterWith(serve(seen)).fetch(ctx())
    expect(seen).toHaveLength(2)
    for (const s of seen) expect(s.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(seen[0]!.url.searchParams.get('max_results')).toBe('100')
    expect(seen[0]!.url.searchParams.get('expansions')).toBe('author_id')
    expect(seen[1]!.url.searchParams.get('next_token')).toBe('NEXT1')
    expect(res.posts).toHaveLength(5)
    const p = res.posts[0]!
    expect(p.sourceKey).toBe('x_api')
    expect(p.externalId).toBe('1003')
    expect(p.url).toBe('https://x.com/LiveMint/status/1003')
    expect(p.text).toContain('Jio IPO GMP')
    expect(p.publishedAt.toISOString()).toBe('2026-10-15T10:30:00.000Z')
    expect(p.reachRaw).toEqual({
      followers: 5_000_000,
      likes: 140,
      retweets: 12,
      replies: 3,
      quotes: 2,
      impressions: 9000,
    })
    expect(p.author).toMatchObject({ platform: 'x', platformUserId: 'u1', kind: 'media_outlet' })
    expect(res.posts[1]!.author?.kind).toBe('other')
    expect(res.posts[2]!.author?.kind).toBe('public_figure')
    expect(res.posts[4]!.url).toBe('https://x.com/i/web/status/999')
  })

  it('stores newest_id per query hash in nextCursor and sends since_id next time', async () => {
    const seen: Seen[] = []
    const a = adapterWith(serve(seen))
    const first = await a.fetch(ctx())
    expect(seen[0]!.url.searchParams.get('start_time')).toBe('2026-10-16T00:00:00Z')
    const cursor = JSON.parse(first.nextCursor!) as Record<string, string>
    expect(Object.values(cursor)).toEqual(['1003'])
    seen.length = 0
    await a.fetch(ctx({ cursor: first.nextCursor }))
    expect(seen[0]!.url.searchParams.get('since_id')).toBe('1003')
    expect(seen[0]!.url.searchParams.has('start_time')).toBe(false)
  })

  it('clamps a first-run since older than 7 days to now - 7d + 60s', async () => {
    const seen: Seen[] = []
    await adapterWith(serve(seen)).fetch(ctx({ since: new Date('2026-09-01T00:00:00Z') }))
    expect(seen[0]!.url.searchParams.get('start_time')).toBe('2026-10-09T12:01:00Z')
  })

  it('limits pages per query via rate_limits.max_pages_per_run', async () => {
    const seen: Seen[] = []
    const source = {
      ...DEFAULT_CONFIG.sources.x_api,
      x_tier: 'basic' as const,
      rate_limits: { max_pages_per_run: 1 },
    }
    await adapterWith(serve(seen)).fetch(ctx({ source }))
    expect(seen).toHaveLength(1)
  })

  it('uses the larger query limit for the pro tier', async () => {
    const seen: Seen[] = []
    await adapterWith(serve(seen)).fetch(ctx({ tier: 'pro', terms: T }))
    expect(seen.length).toBeGreaterThan(0)
    for (const s of seen) expect(s.url.searchParams.get('query')!.length).toBeLessThanOrEqual(4096)
  })

  it('turns 429 with x-rate-limit-reset into RateLimitedError', async () => {
    const reset = Math.floor(NOW.getTime() / 1000) + 600
    const f = createFakeFetch([
      [
        /./,
        () => new Response('{}', { status: 429, headers: { 'x-rate-limit-reset': String(reset) } }),
      ],
    ])
    const err = await adapterWith(f)
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.getTime()).toBe(reset * 1000)
  })

  it('defaults resetAt to now + 15 minutes without the header', async () => {
    const f = createFakeFetch([[/./, () => new Response('{}', { status: 429 })]])
    const err = await adapterWith(f)
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.getTime()).toBe(NOW.getTime() + 15 * 60_000)
  })

  it.each([401, 403])('maps %s to SourceAuthError without leaking the token', async (status) => {
    const f = createFakeFetch([[/./, () => new Response(`bad ${TOKEN}`, { status })]])
    const err = await adapterWith(f)
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SourceAuthError)
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('does not leak the token on other HTTP errors', async () => {
    const f = createFakeFetch([[/./, () => new Response(`oops ${TOKEN}`, { status: 500 })]])
    const err = await adapterWith(f)
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect((err as Error).message).toContain('500')
    expect((err as Error).message).not.toContain(TOKEN)
  })

  it('prices the run at posts * X_COST_PER_POST_USD', async () => {
    const res = await adapterWith(serve([])).fetch(ctx())
    expect(X_COST_PER_POST_USD).toBe(0.005)
    expect(res.costUsd).toBeCloseTo(res.posts.length * X_COST_PER_POST_USD, 10)
  })

  it('rejects live mode without a token', async () => {
    const err = await adapterWith(serve([]))
      .fetch(ctx({ creds: {} }))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NotConfiguredError)
  })

  it('makes zero fetch calls in fixture mode', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const res = await xApi.fetch(ctx({ mode: 'fixture', creds: {} }))
    expect(res.posts.length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()
  })

  it('resolves global fetch lazily', async () => {
    const seen: Seen[] = []
    vi.stubGlobal('fetch', serve(seen))
    const res = await xApi.fetch(ctx())
    expect(res.posts.length).toBeGreaterThan(0)
    expect(seen.length).toBeGreaterThan(0)
  })
})
