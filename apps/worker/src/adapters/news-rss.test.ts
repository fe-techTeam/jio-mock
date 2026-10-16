import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, compileMatcher, type FetchContext } from '@jio/core'
import { createFakeFetch, type FakeRoute } from './_fixture'
import newsRssDefault, {
  PUBLISHER_FEEDS,
  buildGoogleNewsQueries,
  createNewsRssAdapter,
} from './news-rss'

const NOW = new Date('2026-10-16T12:00:00Z')
const SINCE = new Date('2026-10-14T00:00:00Z')
const terms = DEFAULT_CONFIG.terms

const xml = (name: string) =>
  readFileSync(new URL(`./__fixtures__/news-rss/${name}`, import.meta.url), 'utf8')
const EMPTY = '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>'
const ok = (body: string) => new Response(body, { status: 200 })

function ctx(over: Partial<FetchContext> = {}): FetchContext {
  return {
    since: SINCE,
    source: DEFAULT_CONFIG.sources.news_rss,
    terms,
    mode: 'live',
    signal: new AbortController().signal,
    creds: {},
    ...over,
  }
}

function routes(extra: FakeRoute[] = []): { calls: string[]; routes: FakeRoute[] } {
  const calls: string[] = []
  const rec =
    (h: (u: string) => Response): FakeRoute[1] =>
    (u) => {
      calls.push(u)
      return h(u)
    }
  return {
    calls,
    routes: [
      ...extra.map(([p, h]): FakeRoute => [p, rec(h as (u: string) => Response)]),
      [/hl=en-IN/, rec(() => ok(xml('google-news-en.xml')))],
      [/hl=hi/, rec(() => ok(xml('google-news-hi.xml')))],
      [/hl=gu/, rec(() => ok(xml('google-news-gu.xml')))],
      [/livemint\.com\/rss/, rec(() => ok(xml('mint.xml')))],
      [/economictimes\.indiatimes\.com\/markets\/ipos/, rec(() => ok(xml('etmarkets.xml')))],
      [/.*/, rec(() => ok(EMPTY))],
    ],
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('news-rss adapter', () => {
  it('keeps the stub identity', () => {
    expect(newsRssDefault.key).toBe('news_rss')
    expect(newsRssDefault.lane).toBe('media')
    expect(newsRssDefault.requiredCreds).toEqual([])
  })

  it('makes one request per feed with hl/gl/ceid on Google News', async () => {
    const r = routes()
    vi.stubGlobal('fetch', createFakeFetch(r.routes))
    await createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    expect(r.calls).toHaveLength(3 + PUBLISHER_FEEDS.length)
    const gn = r.calls.filter((u) => u.startsWith('https://news.google.com/rss/search'))
    expect(gn).toHaveLength(3)
    expect(gn.find((u) => u.includes('hl=en-IN'))).toMatch(/gl=IN.*ceid=IN(:|%3A)en/)
    expect(gn.find((u) => u.includes('hl=hi'))).toMatch(/gl=IN.*ceid=IN(:|%3A)hi/)
    expect(gn.find((u) => u.includes('hl=gu'))).toMatch(/gl=IN.*ceid=IN(:|%3A)gu/)
  })

  it('maps Google News items with publisher author, stripped html and title+snippet text', async () => {
    const r = routes()
    vi.stubGlobal('fetch', createFakeFetch(r.routes))
    const res = await createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    const gp = res.posts.find((p) => p.externalId === 'gn:CBMi-en-2')
    expect(gp).toBeDefined()
    expect(gp!.author).toMatchObject({
      platform: 'news',
      platformUserId: 'moneycontrol.com',
      displayName: 'Moneycontrol',
      kind: 'media_outlet',
    })
    expect(gp!.text).toBe(
      'Jio IPO GMP today: grey market premium holds - Moneycontrol\n\nGrey market premium steady & firm.',
    )
    expect(gp!.reachRaw).toEqual({})
    expect(gp!.publishedAt.toISOString()).toBe('2026-10-15T10:30:00.000Z')
    expect(gp!.sourceKey).toBe('news_rss')
    expect(res.costUsd).toBe(0)
    const mint = res.posts.find((p) => p.externalId === 'gn:CBMi-en-1')
    expect(mint!.author?.platformUserId).toBe('livemint.com')
    expect(mint!.text).not.toMatch(/[<>]/)
    expect(res.posts.some((p) => p.externalId === 'gn:CBMi-hi-1')).toBe(true)
    expect(res.posts.some((p) => p.externalId === 'gn:CBMi-gu-1')).toBe(true)
  })

  it('drops publisher items failing the core matcher', async () => {
    const r = routes()
    vi.stubGlobal('fetch', createFakeFetch(r.routes))
    const res = await createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    const pub = res.posts.filter((p) => p.externalId.startsWith('pub:'))
    const ids = pub.map((p) => p.externalId)
    expect(ids).toContain('pub:mint-1')
    expect(ids).toContain('pub:et-1')
    expect(ids).not.toContain('pub:mint-2') // JioHotstar
    expect(ids).not.toContain('pub:mint-3') // bare jio lifestyle
    expect(ids).not.toContain('pub:et-2') // unrelated
    const m = compileMatcher(terms)
    for (const p of pub) expect(m(p.text).relevant).toBe(true)
    expect(pub[0]!.author).toMatchObject({ platform: 'news', kind: 'media_outlet' })
  })

  it('drops items before since and dates undated items now', async () => {
    const r = routes()
    vi.stubGlobal('fetch', createFakeFetch(r.routes))
    const res = await createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    expect(res.posts.some((p) => p.externalId === 'gn:CBMi-en-old')).toBe(false)
    const undated = res.posts.find((p) => p.externalId === 'gn:CBMi-en-nodate')
    expect(undated!.publishedAt.toISOString()).toBe(NOW.toISOString())
    const pubUndated = res.posts.find((p) => p.externalId === 'pub:et-3')
    expect(pubUndated!.publishedAt.toISOString()).toBe(NOW.toISOString())
  })

  it('degrades when one feed returns 500', async () => {
    const r = routes([[/livemint\.com\/rss/, () => new Response('boom', { status: 500 })]])
    vi.stubGlobal('fetch', createFakeFetch(r.routes))
    const res = await createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    expect(res.posts.length).toBeGreaterThan(0)
    expect(res.posts.some((p) => p.externalId === 'pub:mint-1')).toBe(false)
    expect(res.posts.some((p) => p.externalId === 'pub:et-1')).toBe(true)
  })

  it('rejects listing every feed name when all feeds fail', async () => {
    vi.stubGlobal('fetch', createFakeFetch([[/.*/, () => new Response('no', { status: 500 })]]))
    const p = createNewsRssAdapter({ now: () => NOW }).fetch(ctx())
    await expect(p).rejects.toThrow(/Google News en/)
    await expect(p).rejects.toThrow(/Mint markets/)
  })

  it('serves fixtures with zero network calls in fixture mode', async () => {
    vi.stubGlobal('fetch', createFakeFetch([]))
    const res = await createNewsRssAdapter({ now: () => NOW }).fetch(ctx({ mode: 'fixture' }))
    expect(res.posts.length).toBeGreaterThan(0)
    expect(res.costUsd).toBe(0)
  })

  it('uses an injected fetch, the user agent and the abort signal', async () => {
    const seen: RequestInit[] = []
    const f = createFakeFetch([
      [
        /.*/,
        (_u, init) => {
          seen.push(init ?? {})
          return ok(EMPTY)
        },
      ],
    ])
    const c = ctx()
    await createNewsRssAdapter({ fetch: f, now: () => NOW }).fetch(c)
    expect(seen).toHaveLength(9)
    for (const init of seen) {
      expect(init.signal).toBe(c.signal)
      expect(JSON.stringify(init.headers)).toContain('jio-ipo-analysis/0.1')
    }
  })
})

describe('buildGoogleNewsQueries', () => {
  it('builds en, hi and gu queries without a bare jio term', () => {
    const qs = buildGoogleNewsQueries(terms, SINCE, NOW)
    expect(qs.map((q) => q.lang)).toEqual(['en', 'hi', 'gu'])
    expect(qs[0]!.q).toContain('"Jio IPO"')
    expect(qs[0]!.q).toContain(' OR ')
    expect(qs[1]!.q).toMatch(/[ऀ-ॿ]/)
    expect(qs[2]!.q).toMatch(/[઀-૿]/)
    for (const q of qs) {
      expect(q.q.replace(/"[^"]*"/g, '').toLowerCase()).not.toMatch(/\bjio\b/)
    }
  })

  it('appends when:7d for an old since and when:1d for a recent one', () => {
    expect(buildGoogleNewsQueries(terms, SINCE, NOW)[0]!.q).toMatch(/when:7d$/)
    const recent = new Date(NOW.getTime() - 3600_000)
    expect(buildGoogleNewsQueries(terms, recent, NOW)[0]!.q).toMatch(/when:1d$/)
  })
})
