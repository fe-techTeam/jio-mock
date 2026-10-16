// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'
import type { ReadCtx } from './ctx'
import { NOW, hoursAgo, many, minutesAgo, resetAndSeed } from './test-fixtures'
import { getTimeline, getTopicMeta } from './timeline'

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
})
