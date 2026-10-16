// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/queries/ctx', () => ({ readCtx: vi.fn(() => ({ fake: 'ctx' })) }))
vi.mock('@/lib/queries/evidence', () => ({ getEvidence: vi.fn() }))

import { auth } from '@/lib/auth'
import { encodeCursor } from '@/lib/queries/cursor'
import { getEvidence } from '@/lib/queries/evidence'
import { GET } from './route'

const getSession = vi.mocked(auth.api.getSession)
const evidence = vi.mocked(getEvidence)
const SESSION = { user: { email: 'a@b.c' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const call = (qs = '') => GET(new Request(`http://localhost:3100/api/evidence${qs}`), {})
const PAGE = { items: [], nextCursor: null, total: 0 }

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(SESSION)
  evidence.mockReset().mockResolvedValue(PAGE)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/evidence', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(evidence).not.toHaveBeenCalled()
  })

  it.each([
    '?entity=anant',
    '?lane=x',
    '?window=30d',
    '?cursor=garbage!!',
    '?from=2026-10-16T00:00:00Z',
    '?limit=500',
    '?topic=../../etc',
  ])('400 for %s', async (qs) => {
    const res = await call(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_request' })
    expect(evidence).not.toHaveBeenCalled()
  })

  it('400 for a cursor made for the other sort', async () => {
    const c = encodeCursor({
      s: 'newest',
      t: '2026-10-16T07:00:00.000Z',
      id: '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c',
    })
    expect((await call(`?sort=reach&cursor=${c}`)).status).toBe(400)
  })

  it('200 with parsed params and no caching', async () => {
    const res = await call('?topic=valuation-price-band&sentiment=negative&window=7d')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual(PAGE)
    expect(evidence).toHaveBeenCalledWith(
      { fake: 'ctx' },
      expect.objectContaining({
        topic: 'valuation-price-band',
        sentiment: 'negative',
        window: '7d',
        sort: 'reach',
        limit: 20,
      }),
    )
    await call('?topic=valuation-price-band&sentiment=negative&window=7d')
    expect(evidence).toHaveBeenCalledTimes(2)
  })

  it('503 when the query rejects', async () => {
    evidence.mockRejectedValue(new Error('db down'))
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'db_unavailable' })
  })
})
