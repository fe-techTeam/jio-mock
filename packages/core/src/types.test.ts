import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  AUTHOR_KINDS,
  CLASSIFICATION_ORIGINS,
  CONFIDENCES,
  COVERAGE_LABELS,
  ENTITY_KEYS,
  EVENT_KINDS,
  FETCH_RUN_STATUSES,
  LANES,
  LANGS,
  MARKET_SERIES,
  SENTIMENTS,
  SOURCE_DEFAULT_LANE,
  SOURCE_KEYS,
  SOURCE_LABEL,
  SOURCE_PLATFORM,
  TOPIC_KINDS,
  TOPIC_STATUSES,
  X_TIERS,
  type AuthorKind,
  type ClassificationOrigin,
  type Confidence,
  type CoverageLabel,
  type EntityFilter,
  type EntityKey,
  type EventKind,
  type FetchRunStatus,
  type Lane,
  type LaneFilter,
  type Lang,
  type MarketSeries,
  type Sentiment,
  type SourceKey,
  type TopicDef,
  type TopicKind,
  type TopicStatus,
  type XTier,
} from './types'
import type {
  FetchContext,
  FetchResult,
  NormalizedAuthor,
  NormalizedPost,
  SourceAdapter,
} from './index'
import type { HealthResponse, LabelRequest } from './api-types'

describe('domain constant arrays (CONTRACTS order)', () => {
  it('SOURCE_KEYS', () => {
    expect(SOURCE_KEYS).toEqual([
      'x_api',
      'x_apify',
      'youtube',
      'reddit',
      'news_rss',
      'web_search',
      'apify_instagram',
      'apify_linkedin',
      'portal_chittorgarh',
      'portal_investorgain',
      'portal_ipowatch',
    ])
  })
  it('LANES, SENTIMENTS, ENTITY_KEYS', () => {
    expect(LANES).toEqual(['social', 'media'])
    expect(SENTIMENTS).toEqual(['positive', 'neutral', 'negative'])
    expect(ENTITY_KEYS).toEqual(['mukesh', 'akash', 'isha', 'jio'])
  })
  it('LANGS, CONFIDENCES, MARKET_SERIES, TOPIC_KINDS', () => {
    expect(LANGS).toEqual(['en', 'hinglish', 'hi', 'gu', 'other'])
    expect(CONFIDENCES).toEqual(['high', 'low'])
    expect(MARKET_SERIES).toEqual([
      'gmp_inr',
      'sub_retail_x',
      'sub_nii_x',
      'sub_qib_x',
      'sub_total_x',
    ])
    expect(TOPIC_KINDS).toEqual(['seed', 'emerging', 'unclassified'])
  })
  it('additions beyond CONTRACTS', () => {
    expect(TOPIC_STATUSES).toEqual(['active', 'dormant', 'dismissed'])
    expect(CLASSIFICATION_ORIGINS).toEqual(['model', 'correction', 'gold'])
    expect(AUTHOR_KINDS).toEqual(['media_outlet', 'public_figure', 'other'])
    expect(EVENT_KINDS).toEqual([
      'fetch_run',
      'login',
      'login_failed',
      'login_locked',
      'logout',
      'view',
      'relabel',
      'config_change',
      'promote_topic',
      'retention',
    ])
    expect(FETCH_RUN_STATUSES).toEqual(['ok', 'error', 'skipped'])
    expect(COVERAGE_LABELS).toEqual(['full_search', 'sampled', 'scraped'])
    expect(X_TIERS).toEqual(['none', 'pay_per_use', 'basic', 'pro', 'enterprise'])
  })
})

describe('derived unions', () => {
  it('equal the element type of their arrays', () => {
    expectTypeOf<SourceKey>().toEqualTypeOf<(typeof SOURCE_KEYS)[number]>()
    expectTypeOf<Lane>().toEqualTypeOf<(typeof LANES)[number]>()
    expectTypeOf<Sentiment>().toEqualTypeOf<(typeof SENTIMENTS)[number]>()
    expectTypeOf<EntityKey>().toEqualTypeOf<(typeof ENTITY_KEYS)[number]>()
    expectTypeOf<Lang>().toEqualTypeOf<(typeof LANGS)[number]>()
    expectTypeOf<Confidence>().toEqualTypeOf<(typeof CONFIDENCES)[number]>()
    expectTypeOf<MarketSeries>().toEqualTypeOf<(typeof MARKET_SERIES)[number]>()
    expectTypeOf<TopicKind>().toEqualTypeOf<(typeof TOPIC_KINDS)[number]>()
    expectTypeOf<TopicStatus>().toEqualTypeOf<(typeof TOPIC_STATUSES)[number]>()
    expectTypeOf<ClassificationOrigin>().toEqualTypeOf<(typeof CLASSIFICATION_ORIGINS)[number]>()
    expectTypeOf<AuthorKind>().toEqualTypeOf<(typeof AUTHOR_KINDS)[number]>()
    expectTypeOf<EventKind>().toEqualTypeOf<(typeof EVENT_KINDS)[number]>()
    expectTypeOf<FetchRunStatus>().toEqualTypeOf<(typeof FETCH_RUN_STATUSES)[number]>()
    expectTypeOf<CoverageLabel>().toEqualTypeOf<(typeof COVERAGE_LABELS)[number]>()
    expectTypeOf<XTier>().toEqualTypeOf<(typeof X_TIERS)[number]>()
    expectTypeOf<EntityFilter>().toEqualTypeOf<'all' | EntityKey>()
    expectTypeOf<LaneFilter>().toEqualTypeOf<'all' | Lane>()
  })
  it('spells the CONTRACTS literals', () => {
    expectTypeOf<Lane>().toEqualTypeOf<'social' | 'media'>()
    expectTypeOf<EntityKey>().toEqualTypeOf<'mukesh' | 'akash' | 'isha' | 'jio'>()
    expectTypeOf<TopicKind>().toEqualTypeOf<'seed' | 'emerging' | 'unclassified'>()
  })
  it('TopicDef has the shape 03-02 imports', () => {
    expectTypeOf<TopicDef>().toEqualTypeOf<{
      slug: string
      name: string
      kind: TopicKind
      description: string
      examplePhrases: string[]
    }>()
  })
})

describe('per-source maps', () => {
  it('cover every source key', () => {
    for (const key of SOURCE_KEYS) {
      expect(SOURCE_DEFAULT_LANE[key], key).toBeDefined()
      expect(SOURCE_PLATFORM[key], key).toBeDefined()
      expect(SOURCE_LABEL[key], key).toBeTruthy()
    }
    expect(Object.keys(SOURCE_DEFAULT_LANE).sort()).toEqual([...SOURCE_KEYS].sort())
    expect(Object.keys(SOURCE_PLATFORM).sort()).toEqual([...SOURCE_KEYS].sort())
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual([...SOURCE_KEYS].sort())
  })
  it('puts news, web search and portals in the media lane, the rest in social', () => {
    const media = SOURCE_KEYS.filter((k) => SOURCE_DEFAULT_LANE[k] === 'media')
    expect(media).toEqual([
      'news_rss',
      'web_search',
      'portal_chittorgarh',
      'portal_investorgain',
      'portal_ipowatch',
    ])
    expect(SOURCE_KEYS.filter((k) => SOURCE_DEFAULT_LANE[k] === 'social')).toEqual([
      'x_api',
      'x_apify',
      'youtube',
      'reddit',
      'apify_instagram',
      'apify_linkedin',
    ])
  })
  it('x_api and x_apify share platform x so X authors merge into one authors row', () => {
    expect(SOURCE_PLATFORM.x_api).toBe('x')
    expect(SOURCE_PLATFORM.x_apify).toBe('x')
    expect(SOURCE_PLATFORM).toMatchObject({
      youtube: 'youtube',
      reddit: 'reddit',
      news_rss: 'news',
      web_search: 'web',
      apify_instagram: 'instagram',
      apify_linkedin: 'linkedin',
      portal_chittorgarh: 'portal',
      portal_investorgain: 'portal',
      portal_ipowatch: 'portal',
    })
  })
  it('has display labels', () => {
    expect(SOURCE_LABEL.x_api).toBe('X (official API)')
    expect(SOURCE_LABEL.x_apify).toBe('X (Apify)')
    expect(SOURCE_LABEL.portal_chittorgarh).toBe('Chittorgarh')
    expect(new Set(Object.values(SOURCE_LABEL)).size).toBe(SOURCE_KEYS.length)
  })
})

describe('adapter and api types', () => {
  it('NormalizedPost matches CONTRACTS plus optional lane', () => {
    expectTypeOf<NormalizedPost['sourceKey']>().toEqualTypeOf<SourceKey>()
    expectTypeOf<NormalizedPost['author']>().toEqualTypeOf<NormalizedAuthor | null>()
    expectTypeOf<NormalizedPost['lane']>().toEqualTypeOf<Lane | undefined>()
    expectTypeOf<NormalizedAuthor['kind']>().toEqualTypeOf<AuthorKind | undefined>()
    expectTypeOf<FetchContext['mode']>().toEqualTypeOf<'live' | 'fixture'>()
    expectTypeOf<SourceAdapter['fetch']>().toEqualTypeOf<
      (ctx: FetchContext) => Promise<FetchResult>
    >()
  })
  it('api-types skeleton', () => {
    expectTypeOf<HealthResponse>().toEqualTypeOf<{ ok: true; db: 'up' | 'down' }>()
    expectTypeOf<LabelRequest['entities']>().toEqualTypeOf<EntityKey[]>()
    expectTypeOf<LabelRequest['origin']>().toEqualTypeOf<'correction' | 'gold'>()
  })
})
