// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { securityHeaders } from './security-headers'

const get = (h: { key: string; value: string }[], k: string) => h.find((x) => x.key === k)?.value

describe('securityHeaders', () => {
  it('prod: strict CSP, HSTS, no unsafe-eval', () => {
    const h = securityHeaders({ dev: false })
    const csp = get(h, 'Content-Security-Policy')!
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain('unsafe-eval')
    for (const d of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "connect-src 'self'",
      "img-src 'self' data: blob:",
    ])
      expect(csp).toContain(d)
    expect(get(h, 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains')
    expect(get(h, 'X-Frame-Options')).toBe('DENY')
    expect(get(h, 'X-Content-Type-Options')).toBe('nosniff')
    expect(get(h, 'Referrer-Policy')).toBe('no-referrer')
    expect(get(h, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()')
    expect(get(h, 'X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('dev: allows unsafe-eval and omits HSTS', () => {
    const h = securityHeaders({ dev: true })
    expect(get(h, 'Content-Security-Policy')).toContain("'unsafe-eval'")
    expect(get(h, 'Strict-Transport-Security')).toBeUndefined()
    expect(get(h, 'X-Frame-Options')).toBe('DENY')
  })
})
