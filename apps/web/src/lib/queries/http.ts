// Shared wrapper for the read route handlers: session check first (401), then the handler.
// ParamError -> 400 {error:'bad_request', issues}; anything else -> 503 {error:'db_unavailable'}
// with the detail only in the server log, so the client keeps its last good data.
import { NextResponse } from 'next/server'
import type { ApiErrorBody } from '@jio/core'
import { auth } from '@/lib/auth'
import { clientIp } from '@/lib/login-guard'
import { apiLimiter } from '@/lib/rate-limit'
import { ParamError } from './errors'

export const DEFAULT_CACHE_CONTROL = 'private, max-age=15'

export function apiError(status: number, error: string, issues?: unknown): Response {
  const body: ApiErrorBody = issues === undefined ? { error } : { error, issues }
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function logFailure(err: unknown) {
  console.error('api read failed', err instanceof Error ? err.message : err)
}

export function withApi<C = unknown>(
  handler: (req: Request, ctx: C) => Promise<unknown>,
  opts: { cacheControl?: string } = {},
): (req: Request, ctx: C) => Promise<Response> {
  const cacheControl = opts.cacheControl ?? DEFAULT_CACHE_CONTROL
  return async (req, ctx) => {
    let session: unknown
    try {
      session = await auth.api.getSession({ headers: req.headers })
    } catch (err) {
      logFailure(err)
      return apiError(503, 'db_unavailable')
    }
    if (!session) return apiError(401, 'unauthorized')

    // x-forwarded-for is trusted only behind a proxy; locally it is client-controlled.
    const user = (session as { user?: { id?: string; email?: string } }).user
    const limit = apiLimiter.check(`${user?.id ?? user?.email ?? 'anon'}|${clientIp(req.headers)}`)
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfterSec) },
        },
      )
    }

    try {
      const body = await handler(req, ctx)
      if (body instanceof Response) return body
      return NextResponse.json(body, { headers: { 'Cache-Control': cacheControl } })
    } catch (err) {
      if (err instanceof ParamError) return apiError(400, 'bad_request', err.issues)
      logFailure(err)
      return apiError(503, 'db_unavailable')
    }
  }
}
