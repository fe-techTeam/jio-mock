// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'
import { getBrief } from './brief'
import type { ReadCtx } from './ctx'
import { NOW, hoursAgo, many, minutesAgo, resetAndSeed, type PostSpec } from './test-fixtures'

let db: Db
let sql: Sql
const ctx = (now: Date = NOW): ReadCtx => ({ db, sql, now })
const ALL = { entity: 'all', lane: 'all' } as const

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_brief')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

const posts = (n: number, topic: string, extra: Partial<PostSpec> = {}, at = minutesAgo(30)) =>
  many(n, () => ({ publishedAt: at, labels: [{ topic, sentiment: 'positive' }], ...extra }))

describe('getBrief topics', () => {
  it('lists only seed topics with at least 10 items in the last 24h', async () => {
    await resetAndSeed(sql, {
      posts: [...posts(9, 'gmp-grey-market'), ...posts(10, 'valuation-price-band')],
    })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.topics.map((t) => t.slug)).toEqual(['valuation-price-band'])
    expect(brief.activeMinItems).toBe(10)
    expect(brief.kpis.items24h).toBe(19)
  })

  it('shows the split at 30 items and hides it at 29', async () => {
    await resetAndSeed(sql, {
      posts: [...posts(29, 'gmp-grey-market'), ...posts(30, 'valuation-price-band')],
    })
    const brief = await getBrief(ctx(), ALL)
    const bySlug = Object.fromEntries(brief.topics.map((t) => [t.slug, t]))
    expect(bySlug['gmp-grey-market']).toMatchObject({ items: 29, splitShown: false })
    expect(bySlug['valuation-price-band']).toMatchObject({ items: 30, pos: 30, splitShown: true })
    expect(brief.minItemsForSplit).toBe(30)
    expect(brief.kpis.splitShown).toBe(true)
  })

  it('hides the KPI split under 30 items', async () => {
    await resetAndSeed(sql, { posts: posts(12, 'gmp-grey-market') })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.kpis).toMatchObject({ items24h: 12, pos: 12, splitShown: false })
  })

  it('ranks many distinct voices above a few loud ones', async () => {
    const loud = many(40, (i) => ({
      publishedAt: minutesAgo(40),
      author: `loud${i % 2}`,
      labels: [{ topic: 'gmp-grey-market' }],
    }))
    const broad = many(30, (i) => ({
      publishedAt: minutesAgo(40),
      author: `voice${i}`,
      labels: [{ topic: 'valuation-price-band' }],
    }))
    await resetAndSeed(sql, {
      authors: [
        ...['loud0', 'loud1'].map((key) => ({ key })),
        ...Array.from({ length: 30 }, (_, i) => ({ key: `voice${i}` })),
      ],
      posts: [...loud, ...broad],
    })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.topics.map((t) => t.slug)).toEqual(['valuation-price-band', 'gmp-grey-market'])
    expect(brief.topics[0]).toMatchObject({ uniqueAuthors24h: 30, trend: 'new', deltaPct: null })
    expect(brief.topics[1]).toMatchObject({ uniqueAuthors24h: 2 })
    expect(brief.topics[0]!.score).toBeGreaterThan(brief.topics[1]!.score)
  })

  it('counts posts without an author as distinct voices', async () => {
    await resetAndSeed(sql, { posts: posts(10, 'gmp-grey-market', { author: null }) })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.topics[0]!.uniqueAuthors24h).toBe(10)
  })

  it('compares with the prior 24h and builds a 24-hour spark', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...posts(12, 'gmp-grey-market', {}, minutesAgo(30)),
        ...posts(9, 'gmp-grey-market', {}, hoursAgo(30)),
        // 25h old: prior window, not the current one
        ...posts(1, 'gmp-grey-market', {}, hoursAgo(25)),
      ],
    })
    const brief = await getBrief(ctx(), ALL)
    const row = brief.topics[0]!
    expect(row).toMatchObject({ items: 12, itemsPrev24h: 10, trend: 'up', deltaPct: 20 })
    expect(row.spark).toHaveLength(24)
    expect(row.spark.reduce((a, b) => a + b, 0)).toBe(12)
    // 07:30Z is the current IST hour (13:00 IST) and holds the posts from 07:30Z
    expect(row.spark[23]).toBe(12)
    expect(brief.kpis).toMatchObject({ items24h: 12, itemsPrev24h: 10 })
  })

  it('excludes emerging and unclassified topics from the table but counts them', async () => {
    await resetAndSeed(sql, {
      topics: [
        { slug: 'emerging-20261016-abc123', name: 'Emerging: lot size', kind: 'emerging' },
        { slug: 'emerging-20261015-def456', name: 'Emerging: quiet', kind: 'emerging' },
      ],
      posts: [
        ...posts(12, 'emerging-20261016-abc123'),
        ...posts(11, 'unclassified'),
        ...posts(10, 'valuation-price-band'),
      ],
    })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.topics.map((t) => t.slug)).toEqual(['valuation-price-band'])
    expect(brief.emerging).toEqual({ count: 12, candidates: 1 })
    expect(brief.unclassified).toEqual({ count: 11 })
    expect(brief.kpis.items24h).toBe(33)
  })

  it('excludes dismissed seed topics', async () => {
    await resetAndSeed(sql, {
      topics: [{ slug: 'gmp-grey-market', status: 'dismissed' }],
      posts: posts(10, 'gmp-grey-market'),
    })
    expect((await getBrief(ctx(), ALL)).topics).toEqual([])
  })

  it('entity=isha reads only isha rows', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...posts(10, 'x', {
          labels: [{ topic: 'ambani-family-leadership', entities: ['isha'] }],
        }),
        ...posts(10, 'x', { labels: [{ topic: 'valuation-price-band', entities: ['mukesh'] }] }),
      ],
    })
    const brief = await getBrief(ctx(), { entity: 'isha', lane: 'all' })
    expect(brief.topics.map((t) => [t.slug, t.items, t.uniqueAuthors24h])).toEqual([
      ['ambani-family-leadership', 10, 10],
    ])
    expect(brief.kpis.items24h).toBe(10)
  })

  it('lane=media reads only media rows', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...posts(10, 'gmp-grey-market', { sourceKey: 'news_rss' }),
        ...posts(10, 'valuation-price-band', { sourceKey: 'reddit' }),
      ],
    })
    const brief = await getBrief(ctx(), { entity: 'all', lane: 'media' })
    expect(brief.topics.map((t) => t.slug)).toEqual(['gmp-grey-market'])
  })

  it('reports low-confidence share and suspected coordination', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...posts(3, 'x', { labels: [{ topic: 'gmp-grey-market', confidence: 'low' }] }),
        ...posts(7, 'gmp-grey-market'),
      ],
      stats: [
        {
          topic: 'gmp-grey-market',
          bucketStart: minutesAgo(30),
          items: 0,
          suspectedCoordinated: 4,
        },
      ],
    })
    const brief = await getBrief(ctx(), ALL)
    expect(brief.topics[0]).toMatchObject({ lowConfPct: 30, suspectedCoordinated: 4 })
    expect(brief.kpis).toMatchObject({ lowConfPct: 30, suspectedCoordinated: 4 })
  })

  it('returns an empty brief on an empty database', async () => {
    await resetAndSeed(sql)
    const brief = await getBrief(ctx(), ALL)
    expect(brief.asOf).toBe(NOW.toISOString())
    expect(brief.topics).toEqual([])
    expect(brief.kpis.items24h).toBe(0)
    expect(brief.market).toEqual({ items: [], unofficial: true })
    expect(brief.freshness.every((f) => f.status === 'waiting')).toBe(true)
  })
})

describe('getBrief freshness and market', () => {
  // Friday 2026-10-16: 04:30Z = 10:00 IST (market hours), 14:30Z = 20:00 IST (closed).
  const morning = new Date('2026-10-16T04:30:00Z')
  const evening = new Date('2026-10-16T14:30:00Z')

  const seedRuns = (now: Date) =>
    resetAndSeed(sql, {
      config: (c) => {
        c.sources.apify_linkedin.enabled = false
      },
      fetchRuns: [
        { sourceKey: 'reddit', at: minutesAgo(3, now), status: 'ok' },
        { sourceKey: 'news_rss', at: minutesAgo(20, now), status: 'ok' },
        { sourceKey: 'x_api', at: minutesAgo(5, now), status: 'ok' },
        { sourceKey: 'x_api', at: minutesAgo(3, now), status: 'error' },
        { sourceKey: 'x_api', at: minutesAgo(2, now), status: 'error' },
        { sourceKey: 'x_api', at: minutesAgo(1, now), status: 'error' },
        { sourceKey: 'portal_chittorgarh', at: minutesAgo(30, now), status: 'ok' },
      ],
      market: [
        { series: 'gmp_inr', value: 40, observedAt: minutesAgo(90, now) },
        { series: 'gmp_inr', value: 42, observedAt: minutesAgo(45, now) },
        { series: 'sub_total_x', value: 3.5, observedAt: minutesAgo(40, now) },
        // a future point is ignored
        { series: 'sub_total_x', value: 99, observedAt: minutesAgo(-10, now) },
      ],
    })

  it('marks ok, stale and waiting sources and omits disabled ones', async () => {
    await seedRuns(evening)
    const brief = await getBrief(ctx(evening), ALL)
    const f = Object.fromEntries(brief.freshness.map((x) => [x.sourceKey, x]))
    expect(f.reddit).toMatchObject({ status: 'ok', ageMin: 3, intervalMin: 5, lane: 'social' })
    expect(f.news_rss).toMatchObject({ status: 'stale', ageMin: 20, intervalMin: 5 })
    expect(f.x_api).toMatchObject({ status: 'stale', consecutiveFailures: 3 })
    expect(f.youtube).toMatchObject({ status: 'waiting', lastSuccessAt: null, ageMin: null })
    expect(f.apify_linkedin).toBeUndefined()
    expect(brief.freshness).toHaveLength(10)
    expect(f.reddit!.lastSuccessAt).toBe(minutesAgo(3, evening).toISOString())
  })

  it('uses the market-hours interval on a weekday at 10:00 IST and the normal one at 20:00', async () => {
    await seedRuns(morning)
    let f = (await getBrief(ctx(morning), ALL)).freshness.find(
      (x) => x.sourceKey === 'portal_chittorgarh',
    )
    expect(f).toMatchObject({ intervalMin: 10, ageMin: 30, status: 'stale' })

    await seedRuns(evening)
    f = (await getBrief(ctx(evening), ALL)).freshness.find(
      (x) => x.sourceKey === 'portal_chittorgarh',
    )
    expect(f).toMatchObject({ intervalMin: 60, ageMin: 30, status: 'ok' })
  })

  it('shows the latest point per series with its source freshness', async () => {
    await seedRuns(evening)
    const brief = await getBrief(ctx(evening), ALL)
    expect(brief.market.unofficial).toBe(true)
    const m = Object.fromEntries(brief.market.items.map((x) => [x.series, x]))
    expect(Object.keys(m).sort()).toEqual(['gmp_inr', 'sub_total_x'])
    expect(m.gmp_inr).toMatchObject({
      value: 42,
      sourceKey: 'portal_chittorgarh',
      observedAt: minutesAgo(45, evening).toISOString(),
      // confirmed by the last successful fetch 30 min ago
      ageMin: 30,
      stale: false,
    })
    expect(m.sub_total_x!.value).toBe(3.5)

    await seedRuns(morning)
    const am = await getBrief(ctx(morning), ALL)
    expect(am.market.items.every((x) => x.stale)).toBe(true)
  })
})
