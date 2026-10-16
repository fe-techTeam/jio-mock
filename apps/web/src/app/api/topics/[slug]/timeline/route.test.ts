// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/queries/ctx', () => ({ readCtx: vi.fn(() => ({ fake: 'ctx' })) }))
vi.mock('@/lib/queries/timeline', () => ({ getTimeline: vi.fn() }))

import { auth } from '@/lib/auth'
import { clearMemo } from '@/lib/queries/cache'
import { getTimeline } from '@/lib/queries/timeline'
import { GET } from './route'

const getSession = vi.mocked(auth.api.getSession)
const timeline = vi.mocked(getTimeline)
const SESSION = { user: { email: 'a@b.c' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const call = (slug: string, qs = '') =>
  GET(new Request(`http://localhost:3100/api/topics/${slug}/timeline${qs}`), {
    params: Promise.resolve({ slug }),
  })

beforeEach(() => {
  clearMemo()
  getSession.mockReset().mockResolvedValue(SESSION)
  timeline.mockReset().mockResolvedValue({ asOf: 'x' } as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/topics/:slug/timeline', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await call('valuation-price-band')).status).toBe(401)
    expect(timeline).not.toHaveBeenCalled()
  })

  it.each([
    ['Bad_Slug', ''],
    ['a'.repeat(65), ''],
    ['valuation-price-band', '?entity=anant'],
    ['valuation-price-band', '?lane=x'],
  ])('400 for slug %s %s', async (slug, qs) => {
    const res = await call(slug, qs)
    expect(res.status).toBe(400)
    expect(timeline).not.toHaveBeenCalled()
  })

  it('404 for an unknown slug', async () => {
    timeline.mockResolvedValue(null)
    const res = await call('no-such-topic')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('200 with Cache-Control, cached 15s per slug and filters', async () => {
    const res = await call('valuation-price-band', '?entity=isha')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, max-age=15')
    expect(timeline).toHaveBeenCalledWith({ fake: 'ctx' }, 'valuation-price-band', {
      entity: 'isha',
      lane: 'all',
    })
    await call('valuation-price-band', '?entity=isha')
    expect(timeline).toHaveBeenCalledTimes(1)
    await call('gmp-grey-market', '?entity=isha')
    expect(timeline).toHaveBeenCalledTimes(2)
  })

  it('503 when the query rejects', async () => {
    timeline.mockRejectedValue(new Error('db down'))
    expect((await call('valuation-price-band')).status).toBe(503)
  })
})
