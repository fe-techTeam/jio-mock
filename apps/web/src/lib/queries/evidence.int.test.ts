// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'
import type { ReadCtx } from './ctx'
import { getEvidence } from './evidence'
import { EvidenceParams, parseParams } from './params'
import { NOW, hoursAgo, many, minutesAgo, resetAndSeed } from './test-fixtures'

let db: Db
let sql: Sql
const ctx = (now: Date = NOW): ReadCtx => ({ db, sql, now })
const SLUG = 'valuation-price-band'
const params = (q = '') => parseParams(EvidenceParams, new URLSearchParams(q))

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_evidence')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('getEvidence privacy', () => {
  it("never returns an 'other' author's handle, ids, followers or raw_json", async () => {
    await resetAndSeed(sql, {
      authors: [
        {
          key: 'person',
          kind: 'other',
          handle: 'private_person_handle',
          displayName: 'Private Person Name',
          followers: 987654,
        },
        { key: 'mint', kind: 'media_outlet', handle: 'livemint', displayName: 'Mint' },
        { key: 'fig', kind: 'public_figure', handle: 'famous', displayName: 'Famous Figure' },
      ],
      posts: [
        {
          sourceKey: 'reddit',
          author: 'person',
          publishedAt: minutesAgo(10),
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'x_api',
          author: 'mint',
          publishedAt: minutesAgo(20),
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'youtube',
          author: 'fig',
          publishedAt: minutesAgo(30),
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'news_rss',
          author: null,
          publishedAt: minutesAgo(40),
          labels: [{ topic: SLUG }],
        },
      ],
    })
    const page = await getEvidence(ctx(), params('sort=newest'))
    const json = JSON.stringify(page)
    expect(json).not.toContain('private_person_handle')
    expect(json).not.toContain('Private Person Name')
    expect(json).not.toContain('987654')
    expect(json).not.toContain('raw-json-marker')
    expect(json).toContain('livemint')
    expect(page.items.map((i) => i.author)).toEqual([
      { visible: false, label: 'Reddit user' },
      { visible: true, kind: 'media_outlet', handle: 'livemint', displayName: 'Mint' },
      { visible: true, kind: 'public_figure', handle: 'famous', displayName: 'Famous Figure' },
      { visible: false, label: 'News source' },
    ])
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      [
        'author',
        'confidence',
        'entities',
        'glossEn',
        'lang',
        'lane',
        'origin',
        'postId',
        'publishedAt',
        'reachRaw',
        'reachScore',
        'sentiment',
        'sourceKey',
        'text',
        'topicSlug',
        'url',
      ].sort(),
    )
  })
})

describe('getEvidence paging', () => {
  // 25 posts with deliberate ties in reach and in published_at.
  const seed25 = () =>
    resetAndSeed(sql, {
      posts: many(25, (i) => ({
        publishedAt: minutesAgo(10 + Math.floor(i / 3)),
        reachScore: i % 4 === 0 ? null : (i % 5) / 10,
        labels: [{ topic: SLUG }],
      })),
    })

  it.each(['reach', 'newest'] as const)('pages 25 rows by 10 with sort=%s', async (sort) => {
    const { postIds } = await seed25()
    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const q: string = `sort=${sort}&limit=10${cursor ? `&cursor=${cursor}` : ''}`
      const page = await getEvidence(ctx(), params(q))
      expect(page.total).toBe(25)
      seen.push(...page.items.map((i) => i.postId))
      cursor = page.nextCursor
      pages++
    } while (cursor && pages < 10)
    expect(pages).toBe(3)
    expect(seen).toHaveLength(25)
    expect(new Set(seen).size).toBe(25)
    expect([...seen].sort()).toEqual([...postIds].sort())
  })

  it('orders by reach desc then newest', async () => {
    await resetAndSeed(sql, {
      posts: [
        { publishedAt: minutesAgo(5), reachScore: 0.1, labels: [{ topic: SLUG }], text: 'low' },
        { publishedAt: minutesAgo(50), reachScore: 0.9, labels: [{ topic: SLUG }], text: 'high' },
        { publishedAt: minutesAgo(1), reachScore: null, labels: [{ topic: SLUG }], text: 'none' },
        {
          publishedAt: minutesAgo(2),
          reachScore: 0.9,
          labels: [{ topic: SLUG }],
          text: 'high-new',
        },
      ],
    })
    const page = await getEvidence(ctx(), params())
    expect(page.items.map((i) => i.text)).toEqual(['high-new', 'high', 'low', 'none'])
    expect(page.items[2]!.reachScore).toBeCloseTo(0.1, 5)
    expect(page.items[3]!.reachScore).toBeNull()
    expect(page.nextCursor).toBeNull()
  })
})

describe('getEvidence filters', () => {
  it('uses the effective label: a correction overrides the model', async () => {
    await resetAndSeed(sql, {
      posts: [
        {
          publishedAt: minutesAgo(10),
          labels: [
            { topic: SLUG, sentiment: 'positive', origin: 'model', createdAt: minutesAgo(9) },
            {
              topic: 'gmp-grey-market',
              sentiment: 'negative',
              origin: 'correction',
              createdAt: minutesAgo(8),
            },
            // a later model row does not beat the correction
            { topic: SLUG, sentiment: 'positive', origin: 'model', createdAt: minutesAgo(7) },
          ],
        },
      ],
    })
    const neg = await getEvidence(ctx(), params('sentiment=negative'))
    expect(neg.items).toHaveLength(1)
    expect(neg.items[0]).toMatchObject({
      sentiment: 'negative',
      origin: 'correction',
      topicSlug: 'gmp-grey-market',
    })
    expect((await getEvidence(ctx(), params('sentiment=positive'))).total).toBe(0)
    expect((await getEvidence(ctx(), params(`topic=${SLUG}`))).total).toBe(0)
  })

  it('excludes a 25h-old post from window 24h and includes it in 7d', async () => {
    await resetAndSeed(sql, {
      posts: [
        { publishedAt: hoursAgo(25), labels: [{ topic: SLUG }], text: 'old' },
        { publishedAt: minutesAgo(10), labels: [{ topic: SLUG }], text: 'new' },
        { publishedAt: hoursAgo(8 * 24), labels: [{ topic: SLUG }], text: 'ancient' },
      ],
    })
    const day = await getEvidence(ctx(), params())
    expect(day.items.map((i) => i.text)).toEqual(['new'])
    const week = await getEvidence(ctx(), params('window=7d&sort=newest'))
    expect(week.items.map((i) => i.text)).toEqual(['new', 'old'])
    const range = await getEvidence(
      ctx(),
      params(`from=${hoursAgo(26).toISOString()}&to=${hoursAgo(24).toISOString()}`),
    )
    expect(range.items.map((i) => i.text)).toEqual(['old'])
  })

  it("reserved slug 'emerging' selects every emerging topic", async () => {
    await resetAndSeed(sql, {
      topics: [
        { slug: 'emerging-20261016-aaaaaa', name: 'Emerging: a', kind: 'emerging' },
        { slug: 'emerging-20261016-bbbbbb', name: 'Emerging: b', kind: 'emerging' },
      ],
      posts: [
        { publishedAt: minutesAgo(10), labels: [{ topic: 'emerging-20261016-aaaaaa' }] },
        { publishedAt: minutesAgo(11), labels: [{ topic: 'emerging-20261016-bbbbbb' }] },
        { publishedAt: minutesAgo(12), labels: [{ topic: 'unclassified' }] },
        { publishedAt: minutesAgo(13), labels: [{ topic: SLUG }] },
      ],
    })
    const em = await getEvidence(ctx(), params('topic=emerging&sort=newest'))
    expect(em.items.map((i) => i.topicSlug)).toEqual([
      'emerging-20261016-aaaaaa',
      'emerging-20261016-bbbbbb',
    ])
    const un = await getEvidence(ctx(), params('topic=unclassified'))
    expect(un.items.map((i) => i.topicSlug)).toEqual(['unclassified'])
    const one = await getEvidence(ctx(), params('topic=emerging-20261016-bbbbbb'))
    expect(one.total).toBe(1)
  })

  it('filters by entity, lane, source and low confidence', async () => {
    await resetAndSeed(sql, {
      posts: [
        {
          sourceKey: 'reddit',
          publishedAt: minutesAgo(10),
          labels: [{ topic: SLUG, entities: ['isha'], confidence: 'low' }],
          text: 'a',
        },
        {
          sourceKey: 'news_rss',
          publishedAt: minutesAgo(11),
          labels: [{ topic: SLUG, entities: ['mukesh', 'isha'] }],
          text: 'b',
          lang: 'hi',
        },
        {
          sourceKey: 'youtube',
          publishedAt: minutesAgo(12),
          labels: [{ topic: SLUG, entities: [], glossEn: 'gloss' }],
          text: 'c',
        },
      ],
    })
    const texts = async (q: string) =>
      (await getEvidence(ctx(), params(`sort=newest&${q}`))).items.map((i) => i.text)
    expect(await texts('entity=isha')).toEqual(['a', 'b'])
    expect(await texts('entity=mukesh')).toEqual(['b'])
    expect(await texts('lane=media')).toEqual(['b'])
    expect(await texts('lane=social')).toEqual(['a', 'c'])
    expect(await texts('source=youtube')).toEqual(['c'])
    expect(await texts('confidence=low')).toEqual(['a'])
    const page = await getEvidence(ctx(), params('sort=newest'))
    expect(page.items[1]).toMatchObject({ lang: 'hi', entities: ['mukesh', 'isha'] })
    expect(page.items[2]).toMatchObject({ glossEn: 'gloss', entities: [] })
    expect(page.items[0]!.publishedAt).toBe(minutesAgo(10).toISOString())
  })

  it('returns an empty page when nothing matches', async () => {
    await resetAndSeed(sql)
    expect(await getEvidence(ctx(), params())).toEqual({ items: [], nextCursor: null, total: 0 })
  })
})
