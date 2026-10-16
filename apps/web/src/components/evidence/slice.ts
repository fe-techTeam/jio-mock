// The evidence slice: which posts the drawer lists. It lives in the `evidence` URL param as a
// nested URLSearchParams string, so any page can open the drawer by writing that one param.
import {
  ENTITY_KEYS,
  EVIDENCE_SORTS,
  EVIDENCE_WINDOWS,
  SENTIMENTS,
  SOURCE_KEYS,
  type EntityKey,
  type EvidenceSort,
  type EvidenceWindow,
  type Sentiment,
  type SourceKey,
} from '@jio/core'
import type { EvidenceQuery, Filters } from '@/lib/api'
import { formatIstRange } from '@/components/shell/format'
import { sourceLabel } from './source-badge'

export type EvidenceSlice = {
  topic?: string
  /** Display name of `topic`, carried so the drawer header needs no extra lookup. */
  topicName?: string
  sentiment?: Sentiment
  /** Overrides the page's entity filter (e.g. an entity-breakdown count). */
  entity?: EntityKey
  window: EvidenceWindow
  /** ISO datetimes; both or neither, at most 7 days apart. They narrow `window`. */
  from?: string
  to?: string
  source?: SourceKey
  confidence?: 'low'
  sort: EvidenceSort
}

/** What callers pass to open the drawer: window defaults to 24h and sort to reach. */
export type EvidenceSliceInput = Omit<EvidenceSlice, 'window' | 'sort'> &
  Partial<Pick<EvidenceSlice, 'window' | 'sort'>>

export function normalizeSlice(input: EvidenceSliceInput): EvidenceSlice {
  return { ...input, window: input.window ?? '24h', sort: input.sort ?? 'reach' }
}

const SLUG_RE = /^[a-z0-9-]{1,64}$/
const MAX_SPAN_MS = 7 * 24 * 60 * 60_000
const MAX_NAME = 120

const KEYS = [
  'topic',
  'topicName',
  'sentiment',
  'entity',
  'window',
  'from',
  'to',
  'source',
  'confidence',
  'sort',
] as const

export function encodeSlice(input: EvidenceSliceInput): string {
  const s = normalizeSlice(input)
  const p = new URLSearchParams()
  for (const k of KEYS) {
    const v = s[k]
    if (v !== undefined && v !== '') p.set(k, v)
  }
  return p.toString()
}

const oneOf = <T extends string>(values: readonly T[], v: string | null): v is T =>
  v !== null && (values as readonly string[]).includes(v)

function isoOrNull(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : v
}

/** Parses the `evidence` param. Any unknown or malformed value returns null (drawer closed). */
export function decodeSlice(raw: string | null | undefined): EvidenceSlice | null {
  if (!raw) return null
  const p = new URLSearchParams(raw)
  const get = (k: (typeof KEYS)[number]) => p.get(k)

  const window = get('window') ?? '24h'
  const sort = get('sort') ?? 'reach'
  if (!oneOf(EVIDENCE_WINDOWS, window) || !oneOf(EVIDENCE_SORTS, sort)) return null
  const slice: EvidenceSlice = { window, sort }

  const topic = get('topic')
  if (topic !== null) {
    if (!SLUG_RE.test(topic)) return null
    slice.topic = topic
  }
  const topicName = get('topicName')
  if (topicName !== null) {
    if (topicName.length === 0 || topicName.length > MAX_NAME) return null
    slice.topicName = topicName
  }
  const sentiment = get('sentiment')
  if (sentiment !== null) {
    if (!oneOf(SENTIMENTS, sentiment)) return null
    slice.sentiment = sentiment
  }
  const entity = get('entity')
  if (entity !== null) {
    if (!oneOf(ENTITY_KEYS, entity)) return null
    slice.entity = entity
  }
  const source = get('source')
  if (source !== null) {
    if (!oneOf(SOURCE_KEYS, source)) return null
    slice.source = source
  }
  const confidence = get('confidence')
  if (confidence !== null) {
    if (confidence !== 'low') return null
    slice.confidence = 'low'
  }
  const from = get('from')
  const to = get('to')
  if ((from === null) !== (to === null)) return null
  if (from !== null && to !== null) {
    if (!isoOrNull(from) || !isoOrNull(to)) return null
    const span = new Date(to).getTime() - new Date(from).getTime()
    if (span <= 0 || span > MAX_SPAN_MS) return null
    slice.from = from
    slice.to = to
  }
  return slice
}

/** The 04-01 evidence query for a slice under the page filters (slice.entity wins). */
export function toEvidenceParams(slice: EvidenceSlice, filters: Filters): EvidenceQuery {
  const q: EvidenceQuery = {
    entity: slice.entity ?? filters.entity,
    lane: filters.lane,
    window: slice.window,
    sort: slice.sort,
  }
  if (slice.topic) q.topic = slice.topic
  if (slice.sentiment) q.sentiment = slice.sentiment
  if (slice.from && slice.to) {
    q.from = slice.from
    q.to = slice.to
  }
  if (slice.source) q.source = slice.source
  if (slice.confidence) q.confidence = slice.confidence
  return q
}

const RESERVED_NAMES: Record<string, string> = {
  emerging: 'Emerging candidates',
  unclassified: 'Unclassified',
}

const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  negative: 'Negative',
}

const LANE_LABEL = { social: 'Social', media: 'Media and analyst' } as const

export const ENTITY_LABEL: Record<EntityKey, string> = {
  mukesh: 'Mukesh',
  akash: 'Akash',
  isha: 'Isha',
  jio: 'Jio',
}

/** 'Valuation and price band, Negative, Last 24h, Social, Isha'. Parts that are 'all' are left out. */
export function describeSlice(slice: EvidenceSlice, filters: Filters): string {
  const parts: string[] = []
  if (slice.topic) parts.push(RESERVED_NAMES[slice.topic] ?? slice.topicName ?? slice.topic)
  else if (!slice.sentiment) parts.push('All topics')
  if (slice.sentiment) parts.push(SENTIMENT_LABEL[slice.sentiment])
  if (slice.confidence === 'low') parts.push('Low confidence')
  if (slice.from && slice.to) parts.push(formatIstRange(slice.from, slice.to))
  else parts.push(slice.window === '24h' ? 'Last 24h' : 'Last 7 days')
  if (slice.source) parts.push(sourceLabel(slice.source))
  if (filters.lane !== 'all') parts.push(LANE_LABEL[filters.lane])
  const entity = slice.entity ?? filters.entity
  if (entity !== 'all') parts.push(ENTITY_LABEL[entity])
  return parts.join(', ')
}
