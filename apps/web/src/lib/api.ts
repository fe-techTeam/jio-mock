// Typed browser client for the read API. Browser-safe: imports only types from @jio/core and
// nothing server-side (no @jio/db, lib/db or lib/auth).
import type {
  ApiErrorBody,
  BriefResponse,
  EntityFilter,
  EvidencePage,
  EvidenceSort,
  EvidenceWindow,
  LaneFilter,
  Sentiment,
  SourceKey,
  TimelineResponse,
} from '@jio/core'

export class ApiError extends Error {
  readonly status: number
  readonly issues?: unknown
  constructor(status: number, message: string, issues?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.issues = issues
  }
}

export type Filters = { entity: EntityFilter; lane: LaneFilter }

export type EvidenceQuery = {
  topic?: string
  sentiment?: Sentiment
  entity?: EntityFilter
  lane?: LaneFilter
  window?: EvidenceWindow
  /** ISO datetimes; both or neither, at most 7 days apart. */
  from?: string
  to?: string
  source?: SourceKey
  confidence?: 'low'
  sort?: EvidenceSort
  cursor?: string
  limit?: number
}

type ParamValue = string | number | null | undefined

export async function fetchJson<T>(
  path: string,
  params: Record<string, ParamValue> = {},
): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  }
  const q = qs.toString()
  const res = await fetch(q ? `${path}?${q}` : path, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (!res.ok) {
    let body: Partial<ApiErrorBody> | null = null
    try {
      body = (await res.json()) as Partial<ApiErrorBody>
    } catch {
      body = null
    }
    throw new ApiError(res.status, body?.error ?? `http_${res.status}`, body?.issues)
  }
  return (await res.json()) as T
}

export function getBrief(f: Filters): Promise<BriefResponse> {
  return fetchJson<BriefResponse>('/api/brief', { entity: f.entity, lane: f.lane })
}

export function getTimeline(slug: string, f: Filters): Promise<TimelineResponse> {
  return fetchJson<TimelineResponse>(`/api/topics/${encodeURIComponent(slug)}/timeline`, {
    entity: f.entity,
    lane: f.lane,
  })
}

export function getEvidence(p: EvidenceQuery): Promise<EvidencePage> {
  return fetchJson<EvidencePage>('/api/evidence', p)
}

export const queryKeys = {
  brief: (f: Filters) => ['brief', f.entity, f.lane] as const,
  timeline: (slug: string, f: Filters) => ['timeline', slug, f.entity, f.lane] as const,
  evidence: (p: EvidenceQuery) => ['evidence', p] as const,
}
