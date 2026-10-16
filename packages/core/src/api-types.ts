// Web API request/response types (CONTRACTS.md "Web API"). Every date is an ISO 8601 string.
// Skeleton from 01-01; 04-01 added the brief, timeline and evidence shapes.
import type {
  AuthorKind,
  ClassificationOrigin,
  Confidence,
  EntityKey,
  Lang,
  Lane,
  LaneFilter,
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

/**
 * Reach-weighted sentiment (06-01): integer percents of sum(reach_score) per sentiment that add up
 * to 100 (largest-remainder rounding). null under `minItemsForSplit` items or when the reach sum is 0.
 */
export type ReachSplit = { pos: number; neu: number; neg: number }

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
  /** Reach-weighted split over the same 24h slice; null under the split minimum. */
  reach: ReachSplit | null
  /**
   * Suspected coordination (06-02): true when any 24h bucket of the slice is a suspected burst.
   * Optional so older fixtures stay valid; /api/brief always sets it.
   */
  burst24h?: boolean
  /** Top-5 authors' share of the slice's 24h posts (0-1, 2 dp) from the latest bucket; null under 30 posts. */
  top5AuthorShare?: number | null
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
  /** Reach-weighted split over the same 24h slice; null under the split minimum. */
  reach: ReachSplit | null
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
  /** The lane filter that was applied (echo of the `lane` param, default 'all'). */
  lane: LaneFilter
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

/**
 * A suspected near-duplicate cluster (06-02): 5+ distinct social authors posting near-identical
 * text within 60 minutes. `posts` counts the cluster's flagged posts in this topic slice and
 * `authors` is a count only: no author handle, id or name is ever part of these types.
 */
export type CoordinationCluster = {
  clusterId: string
  posts: number
  authors: number
  firstAt: string
  lastAt: string
  /** First 140 characters of the earliest post's text. */
  sample: string
}

/** A suspected burst bucket: items above 4x the median of the 96 prior buckets. */
export type CoordinationBurst = {
  bucketStart: string
  items: number
  trailingMedian: number
}

export type TimelineCoordination = {
  /** Suspected clusters touching the topic in the last 7 days; at most 10. */
  clusters: CoordinationCluster[]
  /** Suspected burst buckets in the last 7 days, newest first. */
  bursts: CoordinationBurst[]
  /** Top-5 authors' share of the 24h posts (latest bucket); null under 30 posts. */
  top5AuthorShare: number | null
}

export type TimelineResponse = {
  topic: TimelineTopic
  asOf: string
  /** The lane filter that was applied (echo of the `lane` param, default 'all'). */
  lane: LaneFilter
  minItemsForSplit: number
  /** 168 IST hours, oldest first. */
  series: HourPoint[]
  market: MarketSeriesPoints
  bySource: (SplitCounts & { sourceKey: SourceKey; coverageLabel: string })[]
  byEntity: (SplitCounts & { entity: EntityKey })[]
  /** Suspected coordination (06-02). Optional so older fixtures stay valid; the API always sets it. */
  coordination?: TimelineCoordination
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
  /** posts.coord_suspected (06-02). Optional so older fixtures stay valid; the API always sets it. */
  suspectedCoordinated?: boolean
}

export type EvidencePage = { items: EvidenceItem[]; nextCursor: string | null; total: number }
