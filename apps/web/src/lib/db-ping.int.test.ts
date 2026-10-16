import { afterAll, describe, expect, it } from 'vitest'
import { createPinger } from './db-ping'

const url = process.env.DATABASE_URL_TEST ?? 'postgres://jio:jio@localhost:5433/jio_ipo_test'
const good = createPinger(url)
const bad = createPinger('postgres://jio:jio@localhost:1/none')

afterAll(async () => {
  await Promise.all([good.close(), bad.close()])
})

describe('createPinger (local Postgres)', () => {
  it('pings a reachable database', async () => {
    try {
      await good.ping()
    } catch {
      throw new Error('Database unreachable: run `pnpm db:up && pnpm db:test-setup` first')
    }
  })

  it('rejects within 3s for an unreachable database', async () => {
    const started = Date.now()
    await expect(bad.ping()).rejects.toBeDefined()
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
