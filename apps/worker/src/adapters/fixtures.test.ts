import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  SEED_TOPICS,
  SOURCE_KEYS,
  compileMatcher,
  type EntityKey,
  type FetchContext,
  type SourceKey,
} from '@jio/core'
import { NotConfiguredError } from '../breaker'
import { ADAPTERS } from './index'
import {
  FixtureFile,
  createFakeFetch,
  fixtureToPosts,
  loadFixture,
  readFixtureText,
  type FixturePost,
} from './_fixture'

const POST_KEYS = [
  'x_api',
  'x_apify',
  'youtube',
  'reddit',
  'news_rss',
  'web_search',
  'apify_instagram',
  'apify_linkedin',
] as const satisfies readonly SourceKey[]
const PORTAL_KEYS = ['portal_chittorgarh', 'portal_investorgain', 'portal_ipowatch'] as const

const EXPECTED_COUNTS: Record<(typeof POST_KEYS)[number], number> = {
  x_api: 25,
  x_apify: 25,
  youtube: 20,
  reddit: 20,
  news_rss: 15,
  web_search: 12,
  apify_instagram: 12,
  apify_linkedin: 10,
}

const WEEK_MS = 7 * 86_400_000

function ctx(key: SourceKey, mode: 'live' | 'fixture' = 'fixture'): FetchContext {
  return {
    since: new Date(Date.now() - WEEK_MS),
    source: DEFAULT_CONFIG.sources[key],
    terms: DEFAULT_CONFIG.terms,
    mode,
    signal: new AbortController().signal,
    creds: {},
  }
}

const allItems = (): (FixturePost & { sourceKey: SourceKey })[] =>
  POST_KEYS.flatMap((k) => loadFixture(k).items.map((i) => ({ ...i, sourceKey: k })))

describe('ADAPTERS registry', () => {
  it('has exactly the 11 source keys, each adapter carrying its own key', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...SOURCE_KEYS].sort())
    for (const k of SOURCE_KEYS) expect(ADAPTERS[k].key).toBe(k)
  })

  it('declares the lane and required credentials of each source', () => {
    const want: Record<SourceKey, [string, string[]]> = {
      x_api: ['social', ['X_BEARER_TOKEN']],
      x_apify: ['social', ['APIFY_TOKEN']],
      youtube: ['social', ['YOUTUBE_API_KEY']],
      reddit: ['social', ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET']],
      news_rss: ['media', []],
      web_search: ['media', ['SERPER_API_KEY']],
      apify_instagram: ['social', ['APIFY_TOKEN']],
      apify_linkedin: ['social', ['APIFY_TOKEN']],
      portal_chittorgarh: ['media', []],
      portal_investorgain: ['media', []],
      portal_ipowatch: ['media', []],
    }
    for (const k of SOURCE_KEYS) {
      expect([ADAPTERS[k].lane, ADAPTERS[k].requiredCreds], k).toEqual(want[k])
    }
  })

  // Portal adapters are real parsers since 02-04 (see portal-adapters.test.ts).
  it.each(SOURCE_KEYS.filter((k) => !k.startsWith('portal_')))(
    '%s stub rejects in live mode with NotConfiguredError',
    async (k) => {
      const p = ADAPTERS[k].fetch(ctx(k, 'live'))
      await expect(p).rejects.toBeInstanceOf(NotConfiguredError)
      await expect(ADAPTERS[k].fetch(ctx(k, 'live'))).rejects.toThrow('live mode not built')
    },
  )
})

describe('fixture mode', () => {
  it.each(POST_KEYS)('%s returns its fixture posts', async (k) => {
    const res = await ADAPTERS[k].fetch(ctx(k))
    const now = Date.now()
    expect(res.costUsd).toBe(0)
    expect(res.posts.length).toBeGreaterThanOrEqual(10)
    expect(res.posts.length).toBe(EXPECTED_COUNTS[k])
    const ids = new Set(res.posts.map((p) => p.externalId))
    expect(ids.size).toBe(res.posts.length)
    for (const p of res.posts) {
      expect(p.sourceKey).toBe(k)
      expect(p.externalId).toMatch(/^fx-/)
      expect(p.text.trim().length).toBeGreaterThan(0)
      expect(p.url).toMatch(/^https:\/\//)
      expect(p.publishedAt.getTime()).toBeGreaterThan(now - WEEK_MS)
      expect(p.publishedAt.getTime()).toBeLessThanOrEqual(now)
      expect(p.rawJson).toMatchObject({ fixture: true })
    }
  })

  it.each(PORTAL_KEYS)('%s parses its HTML into 5 market points', async (k) => {
    const res = await ADAPTERS[k].fetch(ctx(k))
    expect(res.marketPoints).toHaveLength(5)
    expect(res.costUsd).toBe(0)
  })
})

describe('fixture content', () => {
  const items = allItems()
  const matcher = compileMatcher(DEFAULT_CONFIG.terms)

  it('meets the language minimums', () => {
    const count = (lang: string) => items.filter((i) => i.lang === lang).length
    expect(count('hinglish')).toBeGreaterThanOrEqual(25)
    expect(count('hi')).toBeGreaterThanOrEqual(15)
    expect(count('gu')).toBeGreaterThanOrEqual(10)
  })

  it('uses Devanagari for hi and Gujarati script for gu', () => {
    for (const i of items.filter((x) => x.lang === 'hi')) expect(i.text, i.id).toMatch(/[ऀ-ॿ]/)
    for (const i of items.filter((x) => x.lang === 'gu')) expect(i.text, i.id).toMatch(/[઀-૿]/)
  })

  it('represents all 10 seed topics', () => {
    const seeds = SEED_TOPICS.filter((t) => t.kind === 'seed').map((t) => t.slug)
    expect(seeds).toHaveLength(10)
    const seen = new Set(items.map((i) => i.topic))
    for (const s of seeds) expect(seen.has(s), s).toBe(true)
  })

  it('represents all 4 entities through the keyword matcher', () => {
    const seen = new Set<EntityKey>()
    for (const i of items) for (const e of matcher(i.text).entities) seen.add(e)
    expect([...seen].sort()).toEqual(['akash', 'isha', 'jio', 'mukesh'])
  })

  it('agrees with the keyword matcher on every item', () => {
    const disagreements = items
      .filter((i) => !i.knownMatcherGap)
      .filter((i) => matcher(i.text).relevant !== i.expectRelevant)
      .map((i) => `${i.id} expected ${i.expectRelevant}: ${i.text}`)
    expect(disagreements).toEqual([])
  })

  it('includes noise that the matcher must reject', () => {
    const noise = items.filter((i) => !i.expectRelevant)
    expect(noise.length).toBeGreaterThanOrEqual(8)
    const text = noise.map((i) => i.text).join('\n')
    expect(text).toMatch(/khul ke jio/i)
    expect(text).toContain('जियो और जीने दो')
    expect(text).toContain('Jio Financial Services')
    expect(text).toContain('JioHotstar')
  })

  it('includes one prompt-injection text', () => {
    const hits = items.filter((i) => /ignore previous instructions/i.test(i.text))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.expectRelevant).toBe(true)
  })

  it('has 6 near-identical Hinglish x_apify posts from 6 authors within 40 minutes', () => {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean)
    const jaccard = (a: string[], b: string[]) => {
      const A = new Set(a)
      const B = new Set(b)
      const inter = [...A].filter((x) => B.has(x)).length
      return inter / new Set([...A, ...B]).size
    }
    const xs = loadFixture('x_apify').items.filter((i) => i.lang === 'hinglish')
    const groups = xs.map((seed) => xs.filter((o) => jaccard(norm(seed.text), norm(o.text)) >= 0.8))
    const best = groups.sort((a, b) => b.length - a.length)[0]!
    expect(best.length).toBeGreaterThanOrEqual(6)
    expect(new Set(best.map((i) => i.author?.platformUserId)).size).toBeGreaterThanOrEqual(6)
    const mins = best.map((i) => i.minutesAgo)
    expect(Math.max(...mins) - Math.min(...mins)).toBeLessThanOrEqual(40)
  })

  it('has public figures and media outlets among X authors', () => {
    const x = items.filter((i) => i.sourceKey === 'x_api' || i.sourceKey === 'x_apify')
    const kinds = (k: string) =>
      new Set(x.filter((i) => i.author?.kind === k).map((i) => i.author!.platformUserId)).size
    expect(kinds('public_figure')).toBeGreaterThanOrEqual(2)
    expect(kinds('media_outlet')).toBeGreaterThanOrEqual(3)
  })

  it('has at least 2 news-channel authors on YouTube', () => {
    const yt = loadFixture('youtube').items
    const outlets = new Set(
      yt.filter((i) => i.author?.kind === 'media_outlet').map((i) => i.author!.platformUserId),
    )
    expect(outlets.size).toBeGreaterThanOrEqual(2)
  })

  it('attributes every news item to its publisher as a media outlet', () => {
    for (const i of loadFixture('news_rss').items) expect(i.author?.kind, i.id).toBe('media_outlet')
  })

  it('covers instagram, linkedin, groww, emkay and centrum in web search', () => {
    const urls = loadFixture('web_search')
      .items.map((i) => i.url)
      .join(' ')
    for (const host of ['instagram.com', 'linkedin.com', 'groww', 'emkay', 'centrum']) {
      expect(urls).toContain(host)
    }
  })
})

describe('_fixture helpers', () => {
  it('FixtureFile rejects minutesAgo beyond 7 days', () => {
    const bad = {
      sourceKey: 'reddit',
      items: [
        {
          id: 'a',
          url: 'https://x',
          minutesAgo: 10_080,
          text: 't',
          lang: 'en',
          author: null,
          reachRaw: {},
        },
      ],
    }
    expect(FixtureFile.safeParse(bad).success).toBe(false)
  })

  it('fixtureToPosts maps ids, dates and raw json', () => {
    const now = new Date('2026-10-19T06:00:00Z')
    const file = FixtureFile.parse({
      sourceKey: 'reddit',
      items: [
        {
          id: 'r1',
          url: 'https://www.reddit.com/r/x/comments/r1/',
          minutesAgo: 90,
          text: 'Jio IPO thread',
          lang: 'en',
          author: { platform: 'reddit', platformUserId: 'u1' },
          reachRaw: { score: 3 },
        },
      ],
    })
    const [p] = fixtureToPosts(file, now)
    expect(p).toMatchObject({
      sourceKey: 'reddit',
      externalId: 'fx-r1',
      url: 'https://www.reddit.com/r/x/comments/r1/',
      text: 'Jio IPO thread',
      author: { platform: 'reddit', platformUserId: 'u1' },
      reachRaw: { score: 3 },
    })
    expect(p!.publishedAt).toEqual(new Date(now.getTime() - 90 * 60_000))
    expect(p!.rawJson).toMatchObject({ fixture: true, id: 'r1', lang: 'en', expectRelevant: true })
  })

  it('caches loaded fixtures', () => {
    expect(loadFixture('reddit')).toBe(loadFixture('reddit'))
  })

  it.each(PORTAL_KEYS)('%s portal HTML has GMP and subscription tables', (k) => {
    const html = readFixtureText(`${k}.html`)
    expect(html).toContain('Jio Platforms')
    for (const s of ['GMP', 'QIB', 'NII', 'Total']) expect(html).toContain(s)
    expect(html).toMatch(/Retail|RII/)
  })

  it('createFakeFetch answers matched routes', async () => {
    const f = createFakeFetch([
      [/^https:\/\/api\.example\/a/, () => new Response('A')],
      [/^https:\/\/api\.example\/b/, async (url) => Response.json({ url })],
    ])
    expect(await (await f('https://api.example/a?x=1')).text()).toBe('A')
    expect(await (await f(new URL('https://api.example/b'))).json()).toEqual({
      url: 'https://api.example/b',
    })
  })

  it('createFakeFetch throws on an unmatched URL', async () => {
    const f = createFakeFetch([[/^https:\/\/api\.example\//, () => new Response('ok')]])
    await expect(f('https://evil.example/x')).rejects.toThrow(
      'Unexpected network call: https://evil.example/x',
    )
  })
})
