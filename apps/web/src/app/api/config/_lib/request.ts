import { auth } from '@/lib/auth'
import { clientIp } from '@/lib/login-guard'
import { apiError } from '@/lib/queries/http'
import type { ValidationIssue } from './contract'

export async function actorOf(req: Request): Promise<{ actor: string; ip: string }> {
  const session = await auth.api.getSession({ headers: req.headers })
  return { actor: session?.user.email ?? 'unknown', ip: clientIp(req.headers) }
}

export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body: unknown = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return body as Record<string, unknown>
    }
  } catch {
    // fall through
  }
  return apiError(400, 'bad_request', [{ path: '', message: 'Expected a JSON object' }])
}

export const validationFailed = (issues: ValidationIssue[]) =>
  apiError(400, 'validation_failed', issues)

export const PERSON_LEVEL_LOCKED = 'person-level views are locked pending legal review'

/** Any spelling of the person-level key is refused, whatever its value. */
export function hasPersonLevelKey(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((k) => k.toLowerCase().replace(/_/g, '') === 'personlevelviews')
}
