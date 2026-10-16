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
        'suspectedCoordinated',
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

describe('getEvidence coordination filters', () => {
  const B = new Date('2026-10-16T07:30:00Z') // a bucket 30 min before NOW
  const seedCoord = () =>
    resetAndSeed(sql, {
      authors: [
        { key: 'person', kind: 'other', handle: 'private_coord_handle', displayName: 'Hidden' },
        { key: 'fig', kind: 'public_figure', handle: 'famous_coord', displayName: 'Famous' },
      ],
      posts: [
        // Cluster nd_a: three flagged posts in bucket B, one flagged an hour earlier.
        ...many(3, (i) => ({
          sourceKey: 'x_api' as const,
          author: i === 0 ? 'person' : i === 1 ? 'fig' : null,
          publishedAt: new Date(B.getTime() + (i + 1) * 60_000),
          coordSuspected: true,
          cluster: 'nd_a',
          text: `a${i}`,
          labels: [
            {
              topic: SLUG,
              sentiment: i === 2 ? ('negative' as const) : ('neutral' as const),
              entities: ['jio' as const],
            },
          ],
        })),
        {
          sourceKey: 'x_api',
          publishedAt: minutesAgo(95),
          coordSuspected: true,
          cluster: 'nd_a',
          text: 'a-early',
          labels: [{ topic: SLUG }],
        },
        // Cluster nd_b: flagged, other topic.
        {
          sourceKey: 'reddit',
          publishedAt: new Date(B.getTime() + 5 * 60_000),
          coordSuspected: true,
          cluster: 'nd_b',
          text: 'b0',
          labels: [{ topic: 'gmp-grey-market' }],
        },
        // Unflagged posts, one in cluster nd_a and one in bucket B.
        {
          sourceKey: 'x_api',
          publishedAt: new Date(B.getTime() + 6 * 60_000),
          cluster: 'nd_a',
          text: 'a-plain',
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'news_rss',
          publishedAt: new Date(B.getTime() + 7 * 60_000),
          text: 'plain',
          labels: [{ topic: SLUG }],
        },
        // Flagged but 25h old: only in the 7d window.
        {
          sourceKey: 'x_api',
          publishedAt: hoursAgo(25),
          coordSuspected: true,
          cluster: 'nd_c',
          text: 'old',
          labels: [{ topic: SLUG }],
        },
      ],
    })
  const texts = async (q: string) =>
    (await getEvidence(ctx(), params(`sort=newest&${q}`))).items.map((i) => i.text)

  it('coordinated=true returns only flagged posts and tags every item', async () => {
    await seedCoord()
    expect(await texts('coordinated=true')).toEqual(['b0', 'a2', 'a1', 'a0', 'a-early'])
    expect(await texts('coordinated=true&window=7d')).toContain('old')
    expect(await texts('coordinated=false')).toHaveLength(7)
    const page = await getEvidence(ctx(), params('sort=newest'))
    const flag = Object.fromEntries(page.items.map((i) => [i.text, i.suspectedCoordinated]))
    expect(flag).toMatchObject({ a0: true, 'a-plain': false, plain: false, b0: true })
  })

  it('cluster limits to that cluster and bucket to [bucket, bucket + 15m)', async () => {
    await seedCoord()
    expect(await texts('cluster=nd_a')).toEqual(['a-plain', 'a2', 'a1', 'a0', 'a-early'])
    expect(await texts('cluster=nd_a&coordinated=true')).toEqual(['a2', 'a1', 'a0', 'a-early'])
    expect(await texts(`bucket=${B.toISOString()}`)).toEqual([
      'plain',
      'a-plain',
      'b0',
      'a2',
      'a1',
      'a0',
    ])
    expect(await texts('cluster=nd_none')).toEqual([])
  })

  it('combines with topic, sentiment, entity, lane and window', async () => {
    await seedCoord()
    const b = B.toISOString()
    expect(await texts(`coordinated=true&topic=${SLUG}&bucket=${b}`)).toEqual(['a2', 'a1', 'a0'])
    expect(await texts(`coordinated=true&sentiment=negative`)).toEqual(['a2'])
    expect(await texts(`coordinated=true&entity=jio`)).toEqual(['a2', 'a1', 'a0'])
    expect(await texts(`coordinated=true&lane=media`)).toEqual([])
    expect(await texts(`cluster=nd_c`)).toEqual([])
    expect(await texts(`cluster=nd_c&window=7d`)).toEqual(['old'])
    const one = await getEvidence(ctx(), params(`coordinated=true&cluster=nd_a&bucket=${b}`))
    expect(one.total).toBe(3)
  })

  it('pages through coordinated posts with the cursor', async () => {
    await seedCoord()
    const first = await getEvidence(ctx(), params('coordinated=true&sort=newest&limit=2'))
    expect(first.items.map((i) => i.text)).toEqual(['b0', 'a2'])
    expect(first.total).toBe(5)
    const second = await getEvidence(
      ctx(),
      params(`coordinated=true&sort=newest&limit=2&cursor=${first.nextCursor}`),
    )
    expect(second.items.map((i) => i.text)).toEqual(['a1', 'a0'])
    const third = await getEvidence(
      ctx(),
      params(`coordinated=true&sort=newest&limit=2&cursor=${second.nextCursor}`),
    )
    expect(third.items.map((i) => i.text)).toEqual(['a-early'])
    expect(third.nextCursor).toBeNull()
  })

  it('keeps the author privacy rule under the new filters', async () => {
    await seedCoord()
    for (const q of ['coordinated=true', 'cluster=nd_a', `bucket=${B.toISOString()}`]) {
      const page = await getEvidence(ctx(), params(`sort=newest&${q}`))
      const json = JSON.stringify(page)
      expect(json).not.toContain('private_coord_handle')
      expect(json).not.toContain('Hidden')
      expect(json).toContain('famous_coord')
    }
  })
})
