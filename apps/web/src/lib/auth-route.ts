import { toNextJsHandler } from 'better-auth/next-js'
import { logEvent, loginFailuresSince, type Db } from '@jio/db'
import type { Auth } from './auth'
import { clientIp, lockoutState } from './login-guard'

const LOOKBACK_MS = 30 * 60_000

export type AuthRouteDeps = { auth: Auth; db: Db; now?: () => Date }

/**
 * Better Auth's HTTP handlers plus the rules the product needs: no sign-up, a 15-minute lock after
 * 5 failed sign-ins, and an event_log row for every login, failure, lock and sign-out. The lock
 * lives here (not in the form) so direct API calls are covered too.
 */
export function createAuthRouteHandlers({ auth, db, now = () => new Date() }: AuthRouteDeps) {
  const base = toNextJsHandler(auth)

  async function audit(e: Parameters<typeof logEvent>[1]): Promise<void> {
    try {
      await logEvent(db, { ...e, at: now() })
    } catch (err) {
      console.error('audit write failed', err instanceof Error ? err.message : err)
    }
  }

  async function signIn(req: Request): Promise<Response> {
    let email: string | undefined
    try {
      const body = (await req.clone().json()) as { email?: unknown }
      if (typeof body.email === 'string' && body.email.trim())
        email = body.email.trim().toLowerCase()
    } catch {
      /* malformed body: let Better Auth reject it */
    }
    if (!email) return base.POST(req)

    const ip = clientIp(req.headers)
    const at = now()
    const failures = await loginFailuresSince(db, email, new Date(at.getTime() - LOOKBACK_MS))
    const state = lockoutState(failures, at)
    if (state.locked && state.until) {
      await audit({ kind: 'login_locked', actor: email, ip })
      const ms = state.until.getTime() - at.getTime()
      const minutes = Math.max(1, Math.ceil(ms / 60_000))
      return Response.json(
        {
          code: 'ACCOUNT_LOCKED',
          message: `Too many failed attempts. Try again in ${minutes} minutes.`,
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(ms / 1000)) } },
      )
    }

    const res = await base.POST(req)
    if (res.ok) {
      await audit({
        kind: 'login',
        actor: email,
        ip,
        detail: { userAgent: req.headers.get('user-agent') },
      })
    } else if (res.status === 401) {
      await audit({ kind: 'login_failed', actor: email, ip })
    }
    return res
  }

  async function signOut(req: Request): Promise<Response> {
    let email: string | undefined
    try {
      const session = await auth.api.getSession({ headers: req.headers })
      email = session?.user.email
    } catch {
      /* no readable session: still forward the sign-out */
    }
    const res = await base.POST(req)
    if (email && res.ok) await audit({ kind: 'logout', actor: email, ip: clientIp(req.headers) })
    return res
  }

  return {
    GET: base.GET,
    async POST(req: Request): Promise<Response> {
      const path = new URL(req.url).pathname
      if (path.includes('/sign-up')) return Response.json({ error: 'not_found' }, { status: 404 })
      if (path.endsWith('/sign-in/email')) return signIn(req)
      if (path.endsWith('/sign-out')) return signOut(req)
      return base.POST(req)
    },
  }
}
