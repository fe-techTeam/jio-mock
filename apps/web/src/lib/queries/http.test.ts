// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))

import { auth } from '@/lib/auth'
import { ParamError } from './errors'
import { apiError, withApi } from './http'

const getSession = vi.mocked(auth.api.getSession)
const req = (url = 'http://localhost:3100/api/x') =>
  new Request(url, { headers: { cookie: 'c=1' } })
const SESSION = { user: { email: 'a@b.c' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>

beforeEach(() => {
  getSession.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('withApi', () => {
  it('returns 401 without a session and never runs the handler', async () => {
    getSession.mockResolvedValue(null)
    const handler = vi.fn()
    const res = await withApi(handler)(req(), {})
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(handler).not.toHaveBeenCalled()
    expect(getSession.mock.calls[0]![0]).toMatchObject({ headers: expect.any(Headers) })
  })

  it('returns 503 when the session lookup itself fails', async () => {
    getSession.mockRejectedValue(new Error('connect ECONNREFUSED postgres://jio:jio@db'))
    const res = await withApi(vi.fn())(req(), {})
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'db_unavailable' })
    expect(text).not.toContain('postgres://')
  })

  it('returns 400 with issues for a ParamError', async () => {
    getSession.mockResolvedValue(SESSION)
    const issues = [{ path: ['entity'], code: 'invalid_value', message: 'bad' }]
    const res = await withApi(async () => {
      throw new ParamError(issues)
    })(req(), {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request', issues })
  })

  it('returns 503 db_unavailable for any other error and logs it', async () => {
    getSession.mockResolvedValue(SESSION)
    const res = await withApi(async () => {
      throw new Error('relation "posts" does not exist')
    })(req(), {})
    expect(res.status).toBe(503)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: 'db_unavailable' })
    expect(text).not.toContain('posts')
    expect(console.error).toHaveBeenCalled()
  })

  it('returns 200 JSON with a private 15s Cache-Control by default', async () => {
    getSession.mockResolvedValue(SESSION)
    const res = await withApi(async () => ({ ok: 1 }))(req(), {})
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=15')
    expect(await res.json()).toEqual({ ok: 1 })
  })

  it('accepts a per-route Cache-Control and passes Responses through', async () => {
    getSession.mockResolvedValue(SESSION)
    const noStore = await withApi(async () => ({ ok: 1 }), { cacheControl: 'no-store' })(req(), {})
    expect(noStore.headers.get('cache-control')).toBe('no-store')
    const passthrough = await withApi(async () => apiError(404, 'not_found'))(req(), {})
    expect(passthrough.status).toBe(404)
    expect(passthrough.headers.get('cache-control')).toBe('no-store')
    expect(await passthrough.json()).toEqual({ error: 'not_found' })
  })

  it('passes the route context through', async () => {
    getSession.mockResolvedValue(SESSION)
    const handler = vi.fn(async (_req: Request, ctx: { params: Promise<{ slug: string }> }) => ({
      slug: (await ctx.params).slug,
    }))
    const res = await withApi(handler)(req(), { params: Promise.resolve({ slug: 'a' }) })
    expect(await res.json()).toEqual({ slug: 'a' })
  })
})
