// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  EVIDENCE_SORTS,
  EVIDENCE_WINDOWS,
  FRESHNESS_STATUSES,
  RESERVED_TOPIC_SLUGS,
  TRENDS,
  VISIBLE_AUTHOR_KINDS,
  type BriefResponse,
  type EvidenceAuthor,
  type EvidenceItem,
  type EvidencePage,
  type HourPoint,
  type MarketSeriesPoints,
  type SourceFreshness,
  type TimelineResponse,
  type TopicRow,
  type Trend,
} from './api-types'
import type { AuthorKind, MarketSeries } from './types'

const topicRow: TopicRow = {
  slug: 'valuation-price-band',
  name: 'Valuation',
  summary2line: 'line one\nline two',
  summaryAt: '2026-10-16T07:30:00.000Z',
  items: 40,
  pos: 10,
  neu: 20,
  neg: 10,
  splitShown: true,
  itemsPrev24h: 20,
  uniqueAuthors24h: 30,
  score: 69.3,
  trend: 'up',
  deltaPct: 100,
  lowConfPct: 2.5,
  suspectedCoordinated: 0,
  spark: Array.from({ length: 24 }, () => 0),
  reach: { pos: 30, neu: 45, neg: 25 },
}

const freshness: SourceFreshness = {
  sourceKey: 'reddit',
  lane: 'social',
  enabled: true,
  intervalMin: 15,
  lastSuccessAt: null,
  ageMin: null,
  consecutiveFailures: 0,
  status: 'waiting',
}

describe('api-types runtime constants', () => {
  it('lists trends, freshness statuses, sorts and windows', () => {
    expect(TRENDS).toEqual(['up', 'down', 'flat', 'new'])
    expect(FRESHNESS_STATUSES).toEqual(['ok', 'stale', 'waiting'])
    expect(EVIDENCE_SORTS).toEqual(['reach', 'newest'])
    expect(EVIDENCE_WINDOWS).toEqual(['24h', '7d'])
    expect(RESERVED_TOPIC_SLUGS).toEqual(['emerging', 'unclassified'])
  })

  it('shows authors only for media outlets and public figures', () => {
    expect(VISIBLE_AUTHOR_KINDS).toEqual(['media_outlet', 'public_figure'])
    expectTypeOf<(typeof VISIBLE_AUTHOR_KINDS)[number]>().toMatchTypeOf<AuthorKind>()
  })
})

describe('api-types shapes', () => {
  it('builds a BriefResponse', () => {
    const brief: BriefResponse = {
      asOf: '2026-10-16T08:00:00.000Z',
      lane: 'all',
      minItemsForSplit: 30,
      activeMinItems: 10,
      kpis: {
        items24h: 40,
        itemsPrev24h: 20,
        pos: 10,
        neu: 20,
        neg: 10,
        splitShown: true,
        lowConfPct: 2.5,
        suspectedCoordinated: 0,
        reach: null,
      },
      topics: [topicRow],
      emerging: { count: 0, candidates: 0 },
      unclassified: { count: 0 },
      market: { items: [], unofficial: true },
      freshness: [freshness],
    }
    expect(brief.topics[0]!.spark).toHaveLength(24)
    expectTypeOf(topicRow.trend).toEqualTypeOf<Trend>()
  })

  it('builds a TimelineResponse', () => {
    const point: HourPoint = {
      hourStart: '2026-10-16T03:30:00.000Z',
      items: 1,
      pos: 1,
      neu: 0,
      neg: 0,
      lowConf: 0,
    }
    const market = {
      gmp_inr: [{ t: '2026-10-16T03:30:00.000Z', v: 42 }],
      sub_retail_x: [],
      sub_nii_x: [],
      sub_qib_x: [],
      sub_total_x: [],
    } satisfies MarketSeriesPoints
    const tl: TimelineResponse = {
      topic: {
        slug: 'valuation-price-band',
        name: 'Valuation',
        kind: 'seed',
        summary2line: null,
        summaryAt: null,
        items24h: 1,
        lastItemAt: '2026-10-16T03:45:00.000Z',
      },
      asOf: '2026-10-16T08:00:00.000Z',
      lane: 'media',
      minItemsForSplit: 30,
      series: [point],
      market,
      bySource: [
        {
          sourceKey: 'reddit',
          coverageLabel: 'full_search',
          items: 1,
          pos: 1,
          neu: 0,
          neg: 0,
          splitShown: false,
        },
      ],
      byEntity: [{ entity: 'isha', items: 0, pos: 0, neu: 0, neg: 0, splitShown: false }],
    }
    expect(tl.series).toHaveLength(1)
    expectTypeOf<keyof MarketSeriesPoints>().toEqualTypeOf<MarketSeries>()
  })

  it('builds an EvidencePage whose hidden author carries only a label', () => {
    const hidden: EvidenceAuthor = { visible: false, label: 'Reddit user' }
    const item: EvidenceItem = {
      postId: '00000000-0000-0000-0000-000000000001',
      sourceKey: 'reddit',
      lane: 'social',
      url: 'https://reddit.com/x',
      publishedAt: '2026-10-16T07:00:00.000Z',
      text: 'GMP looks strong',
      glossEn: null,
      lang: 'en',
      reachScore: null,
      reachRaw: { upvotes: 3 },
      sentiment: 'positive',
      topicSlug: 'valuation-price-band',
      entities: ['jio'],
      confidence: 'high',
      origin: 'model',
      author: hidden,
    }
    const page: EvidencePage = { items: [item], nextCursor: null, total: 1 }
    expect(Object.keys(page.items[0]!.author)).toEqual(['visible', 'label'])
    // @ts-expect-error a hidden author cannot carry a handle
    const bad: EvidenceAuthor = { visible: false, label: 'X user', handle: 'someone' }
    expect(bad).toBeDefined()
  })
})
