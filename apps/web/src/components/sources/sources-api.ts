// Browser client for /api/sources. Types only from the route contract (no server imports).
import type {
  FieldIssue,
  RunRow,
  SourcesPatch,
  SourcesResponse,
} from '@/app/api/sources/_lib/contract'

export class SourcesApiError extends Error {
  readonly status: number
  readonly issues: FieldIssue[]
  constructor(status: number, message: string, issues: FieldIssue[] = []) {
    super(message)
    this.name = 'SourcesApiError'
    this.status = status
    this.issues = issues
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let body: { error?: string; issues?: FieldIssue[] } | null = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    throw new SourcesApiError(res.status, body?.error ?? `http_${res.status}`, body?.issues ?? [])
  }
  return (await res.json()) as T
}

export const SOURCES_KEY = ['sources'] as const
export const runsKey = (key: string) => ['sources', 'runs', key] as const

export const getSources = () => call<SourcesResponse>('/api/sources')
export const getRuns = (key: string) =>
  call<RunRow[]>(`/api/sources/${encodeURIComponent(key)}/runs`)
export const patchSources = (body: SourcesPatch) =>
  call<SourcesResponse>('/api/sources', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

export const CONFLICT_TEXT = 'Config changed since you opened it, reload'

/** Field errors keyed by dotted path, e.g. 'sources.reddit.interval_min'. */
export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (err instanceof SourcesApiError) {
    for (const i of err.issues) out[i.path.join('.')] = i.message
  }
  return out
}
