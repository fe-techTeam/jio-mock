// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'
import type { ReadCtx } from './ctx'
import { NOW, hoursAgo, many, minutesAgo, resetAndSeed } from './test-fixtures'
import { getTimeline, getTopicMeta } from './timeline'
import { floor15 } from './window'

let db: Db
let sql: Sql
const ctx = (now: Date = NOW): ReadCtx => ({ db, sql, now })
const ALL = { entity: 'all', lane: 'all' } as const
const SLUG = 'valuation-price-band'

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_timeline')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})

describe('getTopicMeta', () => {
  it('returns null for an unknown slug', async () => {
    await resetAndSeed(sql)
    expect(await getTopicMeta(ctx(), 'no-such-topic')).toBeNull()
    expect(await getTimeline(ctx(), 'no-such-topic', ALL)).toBeNull()
  })

  it('returns the topic with its summary, 24h items and last item time', async () => {
    await resetAndSeed(sql, {
      topics: [{ slug: SLUG, summary2line: 'one\ntwo', summaryAt: minutesAgo(20) }],
      posts: [
        { publishedAt: minutesAgo(50), labels: [{ topic: SLUG }] },
        { publishedAt: hoursAgo(30), labels: [{ topic: SLUG }] },
      ],
    })
    expect(await getTopicMeta(ctx(), SLUG)).toEqual({
      slug: SLUG,
      name: 'Valuation and price band',
      kind: 'seed',
      summary2line: 'one\ntwo',
      summaryAt: minutesAgo(20).toISOString(),
      items24h: 1,
      lastItemAt: minutesAgo(50).toISOString(),
    })
  })

  it('reports a dormant topic with no items as lastItemAt null', async () => {
    await resetAndSeed(sql)
    expect(await getTopicMeta(ctx(), SLUG)).toMatchObject({ items24h: 0, lastItemAt: null })
  })
})

describe('getTimeline', () => {
  it('returns 168 IST hours with a 03:45Z bucket in the 03:30Z hour', async () => {
    await resetAndSeed(sql, {
      posts: [
        {
          publishedAt: new Date('2026-10-16T03:50:00Z'),
          labels: [{ topic: SLUG, sentiment: 'negative', confidence: 'low' }],
        },
        { publishedAt: new Date('2026-10-16T04:10:00Z'), labels: [{ topic: SLUG }] },
        // 8 days old: outside the timeline
        { publishedAt: hoursAgo(8 * 24), labels: [{ topic: SLUG }] },
      ],
    })
    const tl = await getTimeline(ctx(), SLUG, ALL)
    expect(tl).not.toBeNull()
    expect(tl!.series).toHaveLength(168)
    expect(tl!.series[167]!.hourStart).toBe('2026-10-16T07:30:00.000Z')
    const at = (h: string) => tl!.series.find((p) => p.hourStart === h)
    expect(at('2026-10-16T03:30:00.000Z')).toEqual({
      hourStart: '2026-10-16T03:30:00.000Z',
      items: 2,
      pos: 0,
      neu: 1,
      neg: 1,
      lowConf: 1,
    })
    expect(tl!.series.reduce((a, p) => a + p.items, 0)).toBe(2)
    expect(tl!.asOf).toBe(NOW.toISOString())
    expect(tl!.minItemsForSplit).toBe(30)
  })

  it('reduces market points to the last value per IST hour over 7 days', async () => {
    await resetAndSeed(sql, {
      market: [
        { series: 'gmp_inr', value: 40, observedAt: new Date('2026-10-16T05:35:00Z') },
        { series: 'gmp_inr', value: 44, observedAt: new Date('2026-10-16T06:20:00Z') },
        { series: 'gmp_inr', value: 30, observedAt: hoursAgo(8 * 24) },
        { series: 'sub_qib_x', value: 2.25, observedAt: new Date('2026-10-16T07:00:00Z') },
      ],
    })
    const tl = await getTimeline(ctx(), SLUG, ALL)
    expect(tl!.market.gmp_inr).toEqual([{ t: '2026-10-16T05:30:00.000Z', v: 44 }])
    expect(tl!.market.sub_qib_x).toEqual([{ t: '2026-10-16T06:30:00.000Z', v: 2.25 }])
    expect(tl!.market.sub_retail_x).toEqual([])
    expect(Object.keys(tl!.market).sort()).toEqual([
      'gmp_inr',
      'sub_nii_x',
      'sub_qib_x',
      'sub_retail_x',
      'sub_total_x',
    ])
  })

  it('splits the last 24h by source with coverage labels', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...many(30, () => ({
          sourceKey: 'reddit' as const,
          publishedAt: minutesAgo(30),
          labels: [{ topic: SLUG, sentiment: 'positive' as const }],
        })),
        ...many(2, () => ({
          sourceKey: 'apify_instagram' as const,
          publishedAt: minutesAgo(30),
          labels: [{ topic: SLUG, sentiment: 'negative' as const }],
        })),
        // outside 24h
        { sourceKey: 'news_rss', publishedAt: hoursAgo(25), labels: [{ topic: SLUG }] },
      ],
    })
    const tl = await getTimeline(ctx(), SLUG, ALL)
    expect(tl!.bySource).toEqual([
      {
        sourceKey: 'reddit',
        coverageLabel: 'full_search',
        items: 30,
        pos: 30,
        neu: 0,
        neg: 0,
        splitShown: true,
      },
      {
        sourceKey: 'apify_instagram',
        coverageLabel: 'sampled',
        items: 2,
        pos: 0,
        neu: 0,
        neg: 2,
        splitShown: false,
      },
    ])
  })

  it('breaks down by entity, zero-filled, honouring the lane filter', async () => {
    await resetAndSeed(sql, {
      posts: [
        ...many(3, () => ({
          sourceKey: 'reddit' as const,
          publishedAt: minutesAgo(30),
          labels: [{ topic: SLUG, entities: ['isha' as const, 'jio' as const] }],
        })),
        {
          sourceKey: 'news_rss',
          publishedAt: minutesAgo(30),
          labels: [{ topic: SLUG, entities: ['mukesh'] }],
        },
      ],
    })
    const tl = await getTimeline(ctx(), SLUG, { entity: 'all', lane: 'social' })
    expect(tl!.byEntity.map((e) => [e.entity, e.items, e.splitShown])).toEqual([
      ['mukesh', 0, false],
      ['akash', 0, false],
      ['isha', 3, false],
      ['jio', 3, false],
    ])
    const all = await getTimeline(ctx(), SLUG, ALL)
    expect(all!.byEntity.find((e) => e.entity === 'mukesh')!.items).toBe(1)
  })

  it('applies the entity filter to the series and bySource', async () => {
    await resetAndSeed(sql, {
      posts: [
        { publishedAt: minutesAgo(30), labels: [{ topic: SLUG, entities: ['isha'] }] },
        { publishedAt: minutesAgo(30), labels: [{ topic: SLUG, entities: ['akash'] }] },
      ],
    })
    const tl = await getTimeline(ctx(), SLUG, { entity: 'isha', lane: 'all' })
    expect(tl!.series.reduce((a, p) => a + p.items, 0)).toBe(1)
    expect(tl!.bySource.map((s) => s.items)).toEqual([1])
    expect(tl!.topic.items24h).toBe(1)
  })

  it('echoes the lane filter it applied', async () => {
    await resetAndSeed(sql, { posts: [{ publishedAt: minutesAgo(50), labels: [{ topic: SLUG }] }] })
    expect((await getTimeline(ctx(), SLUG, ALL))!.lane).toBe('all')
    expect((await getTimeline(ctx(), SLUG, { entity: 'all', lane: 'media' }))!.lane).toBe('media')
  })
})

describe('getTimeline coordination', () => {
  const longText = 'Jio IPO allotment is rigged '.repeat(10)

  it('summarises suspected clusters touching the topic over 7 days', async () => {
    await resetAndSeed(sql, {
      authors: [
        { key: 'u1', handle: 'secret_u1' },
        { key: 'u2', handle: 'secret_u2' },
        { key: 'u3', handle: 'secret_u3' },
      ],
      posts: [
        {
          sourceKey: 'x_api',
          author: 'u1',
          publishedAt: hoursAgo(50),
          coordSuspected: true,
          cluster: 'nd_a',
          text: longText,
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'x_api',
          author: 'u2',
          publishedAt: hoursAgo(49.5),
          coordSuspected: true,
          cluster: 'nd_a',
          text: 'later copy',
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'x_api',
          author: null,
          publishedAt: hoursAgo(49.4),
          coordSuspected: true,
          cluster: 'nd_a',
          labels: [{ topic: SLUG }],
        },
        // Same cluster, unflagged: not counted.
        {
          sourceKey: 'x_api',
          author: 'u3',
          publishedAt: hoursAgo(49),
          cluster: 'nd_a',
          labels: [{ topic: SLUG }],
        },
        {
          sourceKey: 'x_api',
          author: 'u3',
          publishedAt: hoursAgo(2),
          coordSuspected: true,
          cluster: 'nd_b',
          text: 'b',
          labels: [{ topic: SLUG, entities: ['isha'] }],
        },
        // Other topic, and older than 7 days.
        {
          sourceKey: 'x_api',
          publishedAt: hoursAgo(3),
          coordSuspected: true,
          cluster: 'nd_other',
          labels: [{ topic: 'gmp-grey-market' }],
        },
        {
          sourceKey: 'x_api',
          publishedAt: hoursAgo(8 * 24),
          coordSuspected: true,
          cluster: 'nd_old',
          labels: [{ topic: SLUG }],
        },
      ],
    })
    const tl = (await getTimeline(ctx(), SLUG, ALL))!
    expect(tl.coordination!.clusters).toEqual([
      {
        clusterId: 'nd_a',
        posts: 3,
        authors: 2,
        firstAt: hoursAgo(50).toISOString(),
        lastAt: hoursAgo(49.4).toISOString(),
        sample: longText.slice(0, 140),
      },
      {
        clusterId: 'nd_b',
        posts: 1,
        authors: 1,
        firstAt: hoursAgo(2).toISOString(),
        lastAt: hoursAgo(2).toISOString(),
        sample: 'b',
      },
    ])
    expect(JSON.stringify(tl.coordination)).not.toMatch(/secret_u|uid-/)
    const isha = (await getTimeline(ctx(), SLUG, { entity: 'isha', lane: 'all' }))!
    expect(isha.coordination!.clusters.map((c) => c.clusterId)).toEqual(['nd_b'])
    const media = (await getTimeline(ctx(), SLUG, { entity: 'all', lane: 'media' }))!
    expect(media.coordination!.clusters).toEqual([])
  })

  it('caps clusters at 10', async () => {
    await resetAndSeed(sql, {
      posts: many(12, (i) => ({
        sourceKey: 'x_api',
        publishedAt: hoursAgo(i + 1),
        coordSuspected: true,
        cluster: `nd_${i}`,
        labels: [{ topic: SLUG }],
      })),
    })
    expect((await getTimeline(ctx(), SLUG, ALL))!.coordination!.clusters).toHaveLength(10)
  })

  it('lists 7d burst buckets with the trailing median and the latest top-5 share', async () => {
    const burstAt = floor15(hoursAgo(5))
    const stats = Array.from({ length: 96 }, (_, i) => ({
      topic: SLUG,
      bucketStart: new Date(burstAt.getTime() - (i + 1) * 15 * 60_000),
      items: i < 60 ? 2 : 0,
    }))
    await resetAndSeed(sql, {
      stats: [
        ...stats,
        { topic: SLUG, bucketStart: burstAt, items: 15, burstFlag: true, top5AuthorShare: 0.3 },
        { topic: SLUG, bucketStart: floor15(hoursAgo(1)), items: 3, top5AuthorShare: 0.45 },
        // Older than 7 days, and a lane row: neither listed under lane=all.
        { topic: SLUG, bucketStart: floor15(hoursAgo(8 * 24)), items: 20, burstFlag: true },
        { topic: SLUG, bucketStart: burstAt, lane: 'social', items: 15, burstFlag: true },
      ],
    })
    const tl = (await getTimeline(ctx(), SLUG, ALL))!
    expect(tl.coordination!.bursts).toEqual([
      { bucketStart: burstAt.toISOString(), items: 15, trailingMedian: 2 },
    ])
    expect(tl.coordination!.top5AuthorShare).toBeCloseTo(0.45, 5)
    const social = (await getTimeline(ctx(), SLUG, { entity: 'all', lane: 'social' }))!
    expect(social.coordination!.bursts).toEqual([
      { bucketStart: burstAt.toISOString(), items: 15, trailingMedian: 0 },
    ])
    expect(social.coordination!.top5AuthorShare).toBeNull()
  })

  it('is empty with no suspected coordination', async () => {
    await resetAndSeed(sql, { posts: [{ publishedAt: hoursAgo(1), labels: [{ topic: SLUG }] }] })
    expect((await getTimeline(ctx(), SLUG, ALL))!.coordination).toEqual({
      clusters: [],
      bursts: [],
      top5AuthorShare: null,
    })
  })
})
