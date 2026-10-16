// Domain constants for the whole app. Each union is derived from an `as const` array so runtime
// validation (zod enums, DB checks) and types never drift apart. Order follows CONTRACTS.md.

export const SOURCE_KEYS = [
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
] as const
export type SourceKey = (typeof SOURCE_KEYS)[number]

export const LANES = ['social', 'media'] as const
export type Lane = (typeof LANES)[number]
export type LaneFilter = 'all' | Lane

export const SENTIMENTS = ['positive', 'neutral', 'negative'] as const
export type Sentiment = (typeof SENTIMENTS)[number]

export const ENTITY_KEYS = ['mukesh', 'akash', 'isha', 'jio'] as const
export type EntityKey = (typeof ENTITY_KEYS)[number]
export type EntityFilter = 'all' | EntityKey

export const LANGS = ['en', 'hinglish', 'hi', 'gu', 'other'] as const
export type Lang = (typeof LANGS)[number]

export const CONFIDENCES = ['high', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const MARKET_SERIES = [
  'gmp_inr',
  'sub_retail_x',
  'sub_nii_x',
  'sub_qib_x',
  'sub_total_x',
] as const
export type MarketSeries = (typeof MARKET_SERIES)[number]

export const TOPIC_KINDS = ['seed', 'emerging', 'unclassified'] as const
export type TopicKind = (typeof TOPIC_KINDS)[number]

export const TOPIC_STATUSES = ['active', 'dormant', 'dismissed'] as const
export type TopicStatus = (typeof TOPIC_STATUSES)[number]

export const CLASSIFICATION_ORIGINS = ['model', 'correction', 'gold'] as const
export type ClassificationOrigin = (typeof CLASSIFICATION_ORIGINS)[number]

export const AUTHOR_KINDS = ['media_outlet', 'public_figure', 'other'] as const
export type AuthorKind = (typeof AUTHOR_KINDS)[number]

export const EVENT_KINDS = [
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
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const FETCH_RUN_STATUSES = ['ok', 'error', 'skipped'] as const
export type FetchRunStatus = (typeof FETCH_RUN_STATUSES)[number]

export const COVERAGE_LABELS = ['full_search', 'sampled', 'scraped'] as const
export type CoverageLabel = (typeof COVERAGE_LABELS)[number]

export const X_TIERS = ['none', 'pay_per_use', 'basic', 'pro', 'enterprise'] as const
export type XTier = (typeof X_TIERS)[number]

/** Default lane per source. Adapters may override per post (NormalizedPost.lane). */
export const SOURCE_DEFAULT_LANE: Record<SourceKey, Lane> = {
  x_api: 'social',
  x_apify: 'social',
  youtube: 'social',
  reddit: 'social',
  news_rss: 'media',
  web_search: 'media',
  apify_instagram: 'social',
  apify_linkedin: 'social',
  portal_chittorgarh: 'media',
  portal_investorgain: 'media',
  portal_ipowatch: 'media',
}

/** authors.platform value. x_api and x_apify share 'x' so one X account is one authors row. */
export const SOURCE_PLATFORM: Record<SourceKey, string> = {
  x_api: 'x',
  x_apify: 'x',
  youtube: 'youtube',
  reddit: 'reddit',
  news_rss: 'news',
  web_search: 'web',
  apify_instagram: 'instagram',
  apify_linkedin: 'linkedin',
  portal_chittorgarh: 'portal',
  portal_investorgain: 'portal',
  portal_ipowatch: 'portal',
}

export const SOURCE_LABEL: Record<SourceKey, string> = {
  x_api: 'X (official API)',
  x_apify: 'X (Apify)',
  youtube: 'YouTube',
  reddit: 'Reddit',
  news_rss: 'News RSS',
  web_search: 'Web search',
  apify_instagram: 'Instagram (Apify)',
  apify_linkedin: 'LinkedIn (Apify)',
  portal_chittorgarh: 'Chittorgarh',
  portal_investorgain: 'InvestorGain',
  portal_ipowatch: 'IPO Watch',
}

/** A topic as the classifier and the seed see it. */
export type TopicDef = {
  slug: string
  name: string
  kind: TopicKind
  description: string
  examplePhrases: string[]
}
