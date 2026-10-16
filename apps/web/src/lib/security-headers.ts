// Response headers applied to every route by next.config.ts. Pure so both modes are testable.
export type Header = { key: string; value: string }

export function securityHeaders({ dev }: { dev: boolean }): Header[] {
  const csp = [
    "default-src 'self'",
    // Next injects inline bootstrap scripts; unsafe-eval is only for dev refresh tooling.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')
  const headers: Header[] = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    // The dashboard URL must not leak to X or Reddit through "Open original".
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
  ]
  if (!dev) {
    headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' })
  }
  return headers
}
