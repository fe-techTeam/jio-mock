import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext } from '@jio/core'
import { RateLimitedError, SourceAuthError } from '../breaker'
import { createFakeFetch, type FakeRoute } from './_fixture'
import webSearchDefault, {
  DOMAIN_OUTLETS,
  SERPER_COST_PER_QUERY_USD,
  createWebSearchAdapter,
  parseSerperDate,
} from './web-search'

const NOW = new Date('2026-10-16T12:00:00Z')
const SINCE = new Date('2026-10-14T00:00:00Z')
const json = (name: string) =>
  readFileSync(new URL(`./__fixtures__/web-search/${name}`, import.meta.url), 'utf8')
const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } })

function ctx(over: Partial<FetchContext> = {}): FetchContext {
  return {
    since: SINCE,
    source: DEFAULT_CONFIG.sources.web_search,
    terms: DEFAULT_CONFIG.terms,
    mode: 'live',
    signal: new AbortController().signal,
    creds: { SERPER_API_KEY: 'k-test' },
    ...over,
  }
}

type Call = { url: string; init: RequestInit; body: { q: string; tbs: string } }

function serper(over: FakeRoute[] = []) {
  const calls: Call[] = []
  const f = createFakeFetch([
    ...over,
    [
      /google\.serper\.dev\/search/,
      (url, init) => {
        const body = JSON.parse(String(init?.body)) as Call['body']
        calls.push({ url, init: init ?? {}, body })
        if (body.q.startsWith('site:')) return reply(json('serper-social.json'))
        if (/Groww|Emkay|Centrum/.test(body.q)) return reply(json('serper-brokers.json'))
        return reply('{"organic":[]}')
      },
    ],
  ])
  return { calls, f }
}

afterEach(() => vi.unstubAllGlobals())

describe('web-search adapter', () => {
  it('keeps the stub identity', () => {
    expect(webSearchDefault.key).toBe('web_search')
    expect(webSearchDefault.lane).toBe('media')
    expect(webSearchDefault.requiredCreds).toEqual(['SERPER_API_KEY'])
  })

  it('POSTs 8 queries with the key header and body shape', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    const res = await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    expect(s.calls).toHaveLength(8)
    const c0 = s.calls[0]!
    expect(c0.url).toBe('https://google.serper.dev/search')
    expect(c0.init.method).toBe('POST')
    const h = c0.init.headers as Record<string, string>
    expect(h['X-API-KEY']).toBe('k-test')
    expect(h['User-Agent']).toContain('jio-ipo-analysis/0.1')
    expect(c0.init.signal).toBeDefined()
    expect(JSON.parse(String(c0.init.body))).toMatchObject({ gl: 'in', hl: 'en', num: 20 })
    expect(res.costUsd).toBeCloseTo(8 * SERPER_COST_PER_QUERY_USD)
  })

  it('builds the site and broker queries from the first two phrases', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    const qs = s.calls.map((c) => c.body.q)
    expect(qs).toContain('site:instagram.com "Jio IPO"')
    expect(qs).toContain('site:linkedin.com/posts "Jio IPO"')
    expect(qs).toContain('site:instagram.com "Jio Platforms IPO"')
    expect(qs.some((q) => q.startsWith('"Jio IPO"') && /Groww/.test(q))).toBe(true)
    expect(qs.some((q) => q.startsWith('"Jio IPO"') && /Emkay/.test(q) && /Centrum/.test(q))).toBe(
      true,
    )
    for (const q of qs) expect(q.replace(/"[^"]*"/g, '')).not.toMatch(/\bjio\b/i)
  })

  it('uses qdr:w for an old since and qdr:d for a recent one', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    expect(new Set(s.calls.map((c) => c.body.tbs))).toEqual(new Set(['qdr:w']))
    s.calls.length = 0
    await createWebSearchAdapter({ now: () => NOW }).fetch(
      ctx({ since: new Date(NOW.getTime() - 3600_000) }),
    )
    expect(new Set(s.calls.map((c) => c.body.tbs))).toEqual(new Set(['qdr:d']))
  })

  it('maps instagram, linkedin and outlet domains to authors', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    const res = await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    const by = (frag: string) => res.posts.find((p) => p.url.includes(frag))!
    expect(by('instagram.com/finance_guru').author).toMatchObject({
      platform: 'instagram',
      platformUserId: 'finance_guru',
      handle: 'finance_guru',
      kind: 'other',
    })
    expect(by('/p/CxYz123AbC').author).toMatchObject({
      platform: 'instagram',
      platformUserId: 'ig-post:CxYz123AbC',
      kind: 'other',
    })
    expect(by('asha-rao-123').author).toMatchObject({
      platform: 'linkedin',
      handle: 'asha-rao-123',
      kind: 'other',
    })
    expect(by('groww.in').author).toMatchObject({
      kind: 'media_outlet',
      platformUserId: 'groww.in',
    })
    expect(by('emkayglobal.com').author?.kind).toBe('media_outlet')
    const other = by('smallblog.example.com').author!
    expect(other.platform).toBe('web')
    expect(other.kind).toBeUndefined()
    // no shared placeholder author across posts
    const ids = res.posts.filter((p) => p.url.includes('/p/')).map((p) => p.author?.platformUserId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('exposes the outlet domain map', () => {
    for (const d of [
      'groww.in',
      'emkayglobal.com',
      'centrum.co.in',
      'livemint.com',
      'economictimes.indiatimes.com',
      'moneycontrol.com',
      'business-standard.com',
      'financialexpress.com',
      'chittorgarh.com',
      'investorgain.com',
      'ipowatch.in',
    ]) {
      expect(DOMAIN_OUTLETS[d]).toBeTruthy()
    }
  })

  it('derives externalId from the normalized link and dedupes across queries', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    const res = await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    const hash = createHash('sha256').update('groww.in/blog/jio-platforms-ipo-review').digest('hex')
    const g = res.posts.find((p) => p.url.includes('groww.in'))!
    expect(g.externalId).toBe(`ws:${hash.slice(0, 16)}`)
    expect(g.externalId).toMatch(/^ws:[0-9a-f]{16}$/)
    const ids = res.posts.map((p) => p.externalId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('builds text from title and snippet and drops results older than since', async () => {
    const s = serper()
    vi.stubGlobal('fetch', s.f)
    const res = await createWebSearchAdapter({ now: () => NOW }).fetch(ctx())
    const g = res.posts.find((p) => p.url.includes('groww.in'))!
    expect(g.text).toBe("Jio Platforms IPO review | Groww\n\nGroww's take on the IPO.")
    expect(g.publishedAt.toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(res.posts.some((p) => p.url.includes('ravi-k'))).toBe(false)
    expect(res.posts.every((p) => p.sourceKey === 'web_search')).toBe(true)
  })

  it('rejects 401 with SourceAuthError and 429 with RateLimitedError', async () => {
    vi.stubGlobal('fetch', createFakeFetch([[/serper/, () => reply('{}', 401)]]))
    await expect(createWebSearchAdapter({ now: () => NOW }).fetch(ctx())).rejects.toBeInstanceOf(
      SourceAuthError,
    )
    vi.stubGlobal('fetch', createFakeFetch([[/serper/, () => reply('{}', 429)]]))
    const err = await createWebSearchAdapter({ now: () => NOW })
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.getTime()).toBe(NOW.getTime() + 15 * 60_000)
  })

  it('serves fixtures with zero network calls in fixture mode', async () => {
    vi.stubGlobal('fetch', createFakeFetch([]))
    const res = await createWebSearchAdapter({ now: () => NOW }).fetch(ctx({ mode: 'fixture' }))
    expect(res.posts.length).toBeGreaterThan(0)
    expect(res.costUsd).toBe(0)
  })
})

describe('parseSerperDate', () => {
  it('parses relative and absolute dates', () => {
    expect(parseSerperDate('3 hours ago', NOW).toISOString()).toBe('2026-10-16T09:00:00.000Z')
    expect(parseSerperDate('2 days ago', NOW).toISOString()).toBe('2026-10-14T12:00:00.000Z')
    expect(parseSerperDate('1 week ago', NOW).toISOString()).toBe('2026-10-09T12:00:00.000Z')
    expect(parseSerperDate('Oct 15, 2026', NOW).toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(parseSerperDate('15 Oct 2026', NOW).toISOString()).toBe('2026-10-15T00:00:00.000Z')
    expect(parseSerperDate(undefined, NOW).toISOString()).toBe(NOW.toISOString())
    expect(parseSerperDate('garbage', NOW).toISOString()).toBe(NOW.toISOString())
  })
})
