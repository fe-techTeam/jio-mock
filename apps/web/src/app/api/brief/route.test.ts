// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/queries/ctx', () => ({ readCtx: vi.fn(() => ({ fake: 'ctx' })) }))
vi.mock('@/lib/queries/brief', () => ({ getBrief: vi.fn() }))

import { auth } from '@/lib/auth'
import { getBrief } from '@/lib/queries/brief'
import { clearMemo } from '@/lib/queries/cache'
import { GET } from './route'

const getSession = vi.mocked(auth.api.getSession)
const brief = vi.mocked(getBrief)
const SESSION = { user: { email: 'a@b.c' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const call = (qs = '') => GET(new Request(`http://localhost:3100/api/brief${qs}`), {})

beforeEach(() => {
  clearMemo()
  getSession.mockReset().mockResolvedValue(SESSION)
  brief.mockReset().mockResolvedValue({ asOf: 'x' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/brief', () => {
  it('401 without a session and the query is not called', async () => {
    getSession.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(brief).not.toHaveBeenCalled()
  })

  it.each(['?entity=anant', '?lane=x'])('400 for %s', async (qs) => {
    const res = await call(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_request', issues: expect.any(Array) })
    expect(brief).not.toHaveBeenCalled()
  })

  it('200 with Cache-Control and parsed filters', async () => {
    const res = await call('?entity=isha&lane=media')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=15')
    expect(await res.json()).toEqual({ asOf: 'x' })
    expect(brief).toHaveBeenCalledWith({ fake: 'ctx' }, { entity: 'isha', lane: 'media' })
  })

  it('calls the query once for two requests within 15s, per filter key', async () => {
    await call()
    await call('?entity=all&lane=all')
    expect(brief).toHaveBeenCalledTimes(1)
    await call('?entity=jio')
    expect(brief).toHaveBeenCalledTimes(2)
  })

  it('503 when the query rejects, and the failure is not cached', async () => {
    brief.mockRejectedValueOnce(new Error('db down'))
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'db_unavailable' })
    expect((await call()).status).toBe(200)
  })

  it('checks the session before the cache', async () => {
    await call()
    getSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
})
