import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db-ping', () => ({ pingDb: vi.fn() }))

import { pingDb } from '@/lib/db-ping'
import { GET } from './route'

const ping = vi.mocked(pingDb)

beforeEach(() => {
  ping.mockReset()
})

describe('GET /api/health', () => {
  it('returns 200 with db up and no-store', async () => {
    ping.mockResolvedValue(undefined)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true, db: 'up' })
  })

  it('returns 200 with db down and leaks no error text', async () => {
    ping.mockRejectedValue(new Error('password authentication failed for postgres://jio:jio@x'))
    const res = await GET()
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ ok: true, db: 'down' })
    expect(text).not.toContain('postgres://')
  })
})
