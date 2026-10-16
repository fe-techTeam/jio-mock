import PgBoss from 'pg-boss'
import type { Logger } from 'pino'
import { createDb, pingDb, type Db } from '@jio/db'
import { isIndianMarketHours } from '@jio/core/time'
import type { WorkerEnv } from './env'
import { ensureQueues, QUEUES } from './queues'

export interface WorkerHandle {
  boss: PgBoss
  db: Db
  stop(): Promise<void>
}

export async function startWorker(args: {
  env: WorkerEnv
  logger: Logger
  bossSchema?: string
}): Promise<WorkerHandle> {
  const { env, logger, bossSchema = 'pgboss' } = args
  const { db, sql } = createDb(env.databaseUrl, { connectTimeoutSec: 3 })
  if (!(await pingDb(sql))) {
    await sql.end({ timeout: 1 })
    throw new Error('database unreachable')
  }
  const boss = new PgBoss({ connectionString: env.databaseUrl, schema: bossSchema })
  boss.on('error', (e) => logger.error({ err: e }, 'pg-boss error'))
  try {
    await boss.start()
    await ensureQueues(boss)
  } catch (e) {
    await boss.stop({ graceful: false, wait: true }).catch(() => {})
    await sql.end({ timeout: 1 })
    throw e
  }
  logger.info(
    {
      sourcesMode: env.sourcesMode,
      queues: QUEUES.length,
      marketHours: isIndianMarketHours(new Date()),
    },
    'worker ready',
  )
  return {
    boss,
    db,
    async stop() {
      await boss.stop({ graceful: true, wait: true, timeout: 10_000 })
      await sql.end({ timeout: 5 })
    },
  }
}
