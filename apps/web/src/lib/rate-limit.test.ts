// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from './rate-limit'

describe('createRateLimiter', () => {
  it('allows max then blocks with a positive retryAfterSec', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 3 })
    for (let i = 0; i < 3; i++) expect(rl.check('a', 1000 + i).ok).toBe(true)
    const r = rl.check('a', 2000)
    expect(r.ok).toBe(false)
    expect(r.retryAfterSec).toBeGreaterThan(0)
    expect(r.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('resets after the window', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1 })
    expect(rl.check('a', 0).ok).toBe(true)
    expect(rl.check('a', 30_000).ok).toBe(false)
    expect(rl.check('a', 60_001).ok).toBe(true)
  })

  it('isolates keys', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 1 })
    expect(rl.check('a', 0).ok).toBe(true)
    expect(rl.check('b', 0).ok).toBe(true)
    expect(rl.check('a', 1).ok).toBe(false)
  })

  it('prunes expired keys so the map does not grow', () => {
    const rl = createRateLimiter({ windowMs: 1000, max: 5 })
    for (let i = 0; i < 50; i++) rl.check(`k${i}`, 0)
    expect(rl.size()).toBe(50)
    rl.check('fresh', 5000)
    expect(rl.size()).toBe(1)
  })
})

describe('shared api guard', () => {
  it('returns 429 rate_limited with Retry-After on the 121st call in a minute', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth', () => ({
      auth: { api: { getSession: vi.fn().mockResolvedValue({ user: { id: 'u1' }, session: {} }) } },
    }))
    const { withApi } = await import('./queries/http')
    const route = withApi(async () => ({ ok: true }))
    const mk = () =>
      new Request('http://localhost/api/x', { headers: { 'x-forwarded-for': '198.51.100.9' } })
    for (let i = 0; i < 120; i++) expect((await route(mk(), {})).status).toBe(200)
    const res = await route(mk(), {})
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    vi.doUnmock('@/lib/auth')
  })
})
