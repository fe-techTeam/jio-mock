import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { loadWorkerEnv } from './env'

describe('loadWorkerEnv', () => {
  it('defaults sourcesMode to auto', () => {
    expect(loadWorkerEnv({ DATABASE_URL: 'postgres://x' })).toEqual({
      databaseUrl: 'postgres://x',
      sourcesMode: 'auto',
    })
  })
  it.each(['fixture', 'live'])('accepts SOURCES_MODE=%s', (m) => {
    expect(loadWorkerEnv({ DATABASE_URL: 'postgres://x', SOURCES_MODE: m }).sourcesMode).toBe(m)
  })
  it('rejects a bogus SOURCES_MODE naming the key', () => {
    try {
      loadWorkerEnv({ DATABASE_URL: 'postgres://x', SOURCES_MODE: 'bogus' })
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError)
      expect(JSON.stringify((e as ZodError).issues)).toContain('SOURCES_MODE')
    }
  })
  it('throws without DATABASE_URL', () => {
    expect(() => loadWorkerEnv({})).toThrow(ZodError)
  })
  it('ignores extra keys', () => {
    const env = loadWorkerEnv({ DATABASE_URL: 'postgres://x', OTHER: '1' })
    expect(Object.keys(env).sort()).toEqual(['databaseUrl', 'sourcesMode'])
  })
})
