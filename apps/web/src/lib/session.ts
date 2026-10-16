import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { logEvent } from '@jio/db'
import { auth } from './auth'
import { clientIp } from './login-guard'
import { getDb } from './db'
import { safeNext } from './safe-next'

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

const COOKIE_NAMES = ['better-auth.session_token', '__Secure-better-auth.session_token']

/**
 * Validates the session against the database or redirects to /login.
 * Every (app) layout must call this: middleware only checks that a cookie exists.
 */
export async function requireSession(): Promise<Session> {
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  const path = h.get('x-pathname') ?? '/'
  if (!session) {
    const jar = await cookies()
    const hadCookie = COOKIE_NAMES.some((n) => jar.has(n))
    const params = new URLSearchParams()
    if (hadCookie) params.set('reason', 'expired')
    params.set('next', safeNext(path))
    redirect(`/login?${params.toString()}`)
  }
  try {
    await logEvent(getDb().db, {
      kind: 'view',
      actor: session.user.email,
      ip: clientIp(h),
      detail: { path },
    })
  } catch (err) {
    console.error('view event failed', err instanceof Error ? err.message : err)
  }
  return session
}
