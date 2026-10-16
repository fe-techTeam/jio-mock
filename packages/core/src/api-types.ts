// Web API request/response types (CONTRACTS.md "Web API"). Every date is an ISO 8601 string.
// Skeleton from 01-01; 04-01 added the brief, timeline and evidence shapes.
import type {
  AuthorKind,
  ClassificationOrigin,
  Confidence,
  EntityKey,
  Lang,
  Lane,
  MarketSeries,
  Sentiment,
  SourceKey,
  TopicKind,
} from './types'

export type HealthResponse = { ok: true; db: 'up' | 'down' }

export type ApiErrorBody = { error: string; issues?: unknown }

export type LabelRequest = {
  postId: string
  origin: 'correction' | 'gold'
  sentiment: Sentiment
  topicSlug: string
  entities: EntityKey[]
}

export type LabelResponse = { ok: true }

// ---------------------------------------------------------------------------------------------
// Shared read-side constants

export const TRENDS = ['up', 'down', 'flat', 'new'] as const
export type Trend = (typeof TRENDS)[number]

export const FRESHNESS_STATUSES = ['ok', 'stale', 'waiting'] as const
export type FreshnessStatus = (typeof FRESHNESS_STATUSES)[number]

export const EVIDENCE_SORTS = ['reach', 'newest'] as const
export type EvidenceSort = (typeof EVIDENCE_SORTS)[number]

export const EVIDENCE_WINDOWS = ['24h', '7d'] as const
export type EvidenceWindow = (typeof EVIDENCE_WINDOWS)[number]

/** Evidence `topic=` values that select every topic of that kind rather than one slug. */
export const RESERVED_TOPIC_SLUGS = ['emerging', 'unclassified'] as const

/** The only author kinds whose handle or display name may leave the server. */
export const VISIBLE_AUTHOR_KINDS = [
  'media_outlet',
  'public_figure',
] as const satisfies readonly AuthorKind[]
export type VisibleAuthorKind = (typeof VISIBLE_AUTHOR_KINDS)[number]

/** Sentiment counts for one slice. `splitShown` is false under `minItemsForSplit` items. */
export type SplitCounts = {
  items: number
  pos: number
  neu: number
  neg: number
  splitShown: boolean
}

// ---------------------------------------------------------------------------------------------
// GET /api/brief

export type TopicRow = SplitCounts & {
  slug: string
  name: string
  summary2line: string | null
  summaryAt: string | null
  itemsPrev24h: number
  uniqueAuthors24h: number
  score: number
  trend: Trend
  /** null when the prior 24h had no items. */
  deltaPct: number | null
  lowConfPct: number
  suspectedCoordinated: number
  /** 24 item counts, one per IST hour, oldest first, ending with the current hour. */
  spark: number[]
}

/** pos/neu/neg are counts; the UI turns them into percentages. */
export type BriefKpis = {
  items24h: number
  itemsPrev24h: number
  pos: number
  neu: number
  neg: number
  splitShown: boolean
  lowConfPct: number
  suspectedCoordinated: number
}

export type MarketStripItem = {
  series: MarketSeries
  value: number
  observedAt: string
  sourceKey: SourceKey
  sourceUrl: string
  ageMin: number
  stale: boolean
}

export type MarketStrip = { items: MarketStripItem[]; unofficial: true }

export type SourceFreshness = {
  sourceKey: SourceKey
  lane: Lane
  enabled: boolean
  /** The interval in effect now (the market-hours one during Indian market hours, when set). */
  intervalMin: number
  lastSuccessAt: string | null
  ageMin: number | null
  consecutiveFailures: number
  status: FreshnessStatus
}

export type BriefResponse = {
  asOf: string
  minItemsForSplit: number
  activeMinItems: number
  kpis: BriefKpis
  /** Active seed topics, ranked. */
  topics: TopicRow[]
  /** count = items in emerging topics; candidates = emerging topics with items. */
  emerging: { count: number; candidates: number }
  unclassified: { count: number }
  market: MarketStrip
  freshness: SourceFreshness[]
}

// ---------------------------------------------------------------------------------------------
// GET /api/topics/:slug/timeline

export type HourPoint = {
  hourStart: string
  items: number
  pos: number
  neu: number
  neg: number
  lowConf: number
}

export type MarketSeriesPoints = Record<MarketSeries, { t: string; v: number }[]>

export type TimelineTopic = {
  slug: string
  name: string
  kind: TopicKind
  summary2line: string | null
  summaryAt: string | null
  items24h: number
  lastItemAt: string | null
}

export type TimelineResponse = {
  topic: TimelineTopic
  asOf: string
  minItemsForSplit: number
  /** 168 IST hours, oldest first. */
  series: HourPoint[]
  market: MarketSeriesPoints
  bySource: (SplitCounts & { sourceKey: SourceKey; coverageLabel: string })[]
  byEntity: (SplitCounts & { entity: EntityKey })[]
}

// ---------------------------------------------------------------------------------------------
// GET /api/evidence

export type EvidenceAuthor =
  | {
      visible: true
      kind: VisibleAuthorKind
      displayName: string | null
      handle: string | null
    }
  | { visible: false; label: string }

export type EvidenceItem = {
  postId: string
  sourceKey: SourceKey
  lane: Lane
  url: string
  publishedAt: string
  text: string
  glossEn: string | null
  lang: Lang
  reachScore: number | null
  reachRaw: Record<string, number>
  sentiment: Sentiment
  topicSlug: string
  entities: EntityKey[]
  confidence: Confidence
  origin: ClassificationOrigin
  author: EvidenceAuthor
}

export type EvidencePage = { items: EvidenceItem[]; nextCursor: string | null; total: number }
