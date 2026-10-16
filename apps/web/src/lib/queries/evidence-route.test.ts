// @vitest-environment node
// Route-level checks for the 06-02 evidence params (coordinated, cluster, bucket). Kept beside
// params.ts, which holds the schema the route parses with.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/queries/ctx', () => ({ readCtx: vi.fn(() => ({ fake: 'ctx' })) }))
vi.mock('@/lib/queries/evidence', () => ({ getEvidence: vi.fn() }))

import { GET } from '@/app/api/evidence/route'
import { auth } from '@/lib/auth'
import { getEvidence } from '@/lib/queries/evidence'

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

describe('GET /api/evidence coordination params', () => {
  it.each([
    '?bucket=yesterday',
    '?bucket=2026-10-16',
    '?coordinated=maybe',
    `?cluster=${'x'.repeat(65)}`,
  ])('400 for %s', async (qs) => {
    const res = await call(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_request' })
    expect(evidence).not.toHaveBeenCalled()
  })

  it('passes coordinated, cluster and bucket through parsed', async () => {
    const res = await call(
      '?coordinated=true&cluster=nd_abc&bucket=2026-10-16T07:30:00Z&topic=valuation-price-band',
    )
    expect(res.status).toBe(200)
    expect(evidence).toHaveBeenCalledWith(
      { fake: 'ctx' },
      expect.objectContaining({
        coordinated: true,
        cluster: 'nd_abc',
        bucket: new Date('2026-10-16T07:30:00Z'),
        topic: 'valuation-price-band',
      }),
    )
  })

  it('coordinated=false parses to false, not true', async () => {
    expect((await call('?coordinated=false')).status).toBe(200)
    expect(evidence).toHaveBeenCalledWith(
      { fake: 'ctx' },
      expect.objectContaining({ coordinated: false }),
    )
  })
})
