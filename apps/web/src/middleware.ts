import { getSessionCookie } from 'better-auth/cookies'
import { NextResponse, type NextRequest } from 'next/server'

// Optimistic check only (cookie present). Real validation happens in requireSession() and in each
// API route; this keeps anonymous visitors off every page and API by default.
const PUBLIC = [/^\/login(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/health(\/|$)/]

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const headers = new Headers(request.headers)
  headers.set('x-pathname', pathname + search)

  if (PUBLIC.some((p) => p.test(pathname)) || getSessionCookie(request)) {
    return NextResponse.next({ request: { headers } })
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = request.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  url.searchParams.set('next', pathname + search)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|avif)$).*)',
  ],
}
