import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkHealth } from './health'

afterEach(() => {
  vi.useRealTimers()
})

describe('checkHealth', () => {
  it('reports db up when the ping resolves', async () => {
    await expect(checkHealth(() => Promise.resolve())).resolves.toEqual({ ok: true, db: 'up' })
  })

  it('reports db down when the ping rejects', async () => {
    await expect(checkHealth(() => Promise.reject(new Error('boom')))).resolves.toEqual({
      ok: true,
      db: 'down',
    })
  })

  it('reports db down when the ping never settles', async () => {
    vi.useFakeTimers()
    const result = checkHealth(() => new Promise<void>(() => {}))
    await vi.advanceTimersByTimeAsync(2000)
    await expect(result).resolves.toEqual({ ok: true, db: 'down' })
  })

  it('clears the timeout timer after success', async () => {
    vi.useFakeTimers()
    await checkHealth(() => Promise.resolve())
    expect(vi.getTimerCount()).toBe(0)
  })
})
