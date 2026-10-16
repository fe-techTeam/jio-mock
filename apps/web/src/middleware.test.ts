// @vitest-environment node
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { middleware } from './middleware'

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3100${path}`, cookie ? { headers: { cookie } } : undefined)

describe('middleware', () => {
  it('redirects an unauthenticated page request to /login with next', () => {
    const res = middleware(req('/'))
    expect(res.status).toBe(307)
    expect(
      new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search,
    ).toBe('/login?next=%2F')
  })

  it('keeps the encoded path and query in next', () => {
    const res = middleware(req('/topics/valuation-price-band?entity=isha'))
    const loc = new URL(res.headers.get('location')!)
    expect(loc.searchParams.get('next')).toBe('/topics/valuation-price-band?entity=isha')
    expect(loc.search).toContain('next=%2Ftopics%2Fvaluation-price-band%3Fentity%3Disha')
  })

  it('answers 401 JSON for unauthenticated API calls', async () => {
    const res = middleware(req('/api/brief'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it.each(['/login', '/api/health', '/api/auth/sign-in/email'])('lets %s through', (p) => {
    expect(middleware(req(p)).headers.get('x-middleware-next')).toBe('1')
  })

  it.each(['better-auth.session_token', '__Secure-better-auth.session_token'])(
    'passes with a %s cookie and forwards x-pathname',
    (name) => {
      const res = middleware(req('/topics/a?entity=isha', `${name}=abc`))
      expect(res.headers.get('x-middleware-next')).toBe('1')
      expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/topics/a?entity=isha')
    },
  )
})
