import { afterAll, describe, expect, it } from 'vitest'
import pino from 'pino'
import { randomBytes } from 'node:crypto'
import { createDb } from '@jio/db'
import { TEST_DATABASE_URL } from '@jio/db/testing'
import { startWorker } from './boot'
import { QUEUES } from './queues'

const logger = pino({ level: 'silent' })
const schemas: string[] = []
const newSchema = () => {
  const s = 'pgboss_test_' + randomBytes(4).toString('hex')
  schemas.push(s)
  return s
}

afterAll(async () => {
  const { sql } = createDb(TEST_DATABASE_URL, { max: 1 })
  for (const s of schemas) await sql.unsafe(`drop schema if exists ${s} cascade`)
  await sql.end({ timeout: 5 })
})

describe('startWorker', () => {
  it('boots, creates contract queues, round-trips a job and stops', async () => {
    const handle = await startWorker({
      env: { databaseUrl: TEST_DATABASE_URL, sourcesMode: 'auto' },
      logger,
      bossSchema: newSchema(),
    })
    const queues = (await handle.boss.getQueues()).map((q) => q.name)
    for (const name of QUEUES) expect(queues).toContain(name)

    await handle.boss.send('rollup', { probe: 1 })
    const jobs = await handle.boss.fetch('rollup')
    expect(jobs[0]?.data).toEqual({ probe: 1 })

    await expect(handle.stop()).resolves.toBeUndefined()
  })

  it('rejects with a clear error when the database is unreachable', async () => {
    await expect(
      startWorker({
        env: { databaseUrl: 'postgres://jio:jio@localhost:1/none', sourcesMode: 'auto' },
        logger,
        bossSchema: newSchema(),
      }),
    ).rejects.toThrow('database unreachable')
  })
})
