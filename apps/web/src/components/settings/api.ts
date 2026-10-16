// Browser client for the Settings endpoints.
import type {
  AuditResponse,
  ConfigPatch,
  ConfigResponse,
  ConfigTopicsResponse,
  PromoteBody,
  TestTermsRequest,
  TestTermsResponse,
  TopicPatch,
  ValidationIssue,
} from '@/app/api/config/_lib/contract'
import { ApiError, fetchJson } from '@/lib/api'

export async function sendJson<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let parsed: { error?: string; issues?: unknown } | null = null
    try {
      parsed = (await res.json()) as { error?: string; issues?: unknown }
    } catch {
      parsed = null
    }
    throw new ApiError(res.status, parsed?.error ?? `http_${res.status}`, parsed?.issues)
  }
  return (await res.json()) as T
}

export const getSettingsConfig = () => fetchJson<ConfigResponse>('/api/config')
export const getConfigTopics = () => fetchJson<ConfigTopicsResponse>('/api/config/topics')
export const getAudit = (cursor?: string | null) =>
  fetchJson<AuditResponse>('/api/config/audit', { cursor })

export const patchConfig = (b: ConfigPatch) => sendJson<ConfigResponse>('PATCH', '/api/config', b)
export const testTerms = (b: TestTermsRequest) =>
  sendJson<TestTermsResponse>('POST', '/api/config/test-terms', b)
export const patchTopic = (b: TopicPatch) =>
  sendJson<{ ok: true }>('PATCH', '/api/config/topics', b)
export const promoteTopic = (slug: string, b: PromoteBody) =>
  sendJson<{ ok: true; movedClassifications?: number }>(
    'POST',
    `/api/topics/${encodeURIComponent(slug)}/promote`,
    b,
  )

export const configKey = ['config'] as const
export const topicsKey = ['config-topics'] as const
export const auditKey = ['config-audit'] as const

/** A message for a failed save: the server's validation issues, else its error text. */
export function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = err.issues as ValidationIssue[] | undefined
    if (Array.isArray(issues) && issues.length > 0 && issues[0]?.message) {
      return issues.map((i) => i.message).join('; ')
    }
    return err.message
  }
  return 'Could not save. Check your connection and try again.'
}
