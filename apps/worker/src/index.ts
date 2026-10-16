// Worker entry point. `main` starts pg-boss, the fetch workers and the 60s scheduler;
// `main(['--once'])` runs every enabled source once without pg-boss and prints a table.
import { pathToFileURL } from 'node:url'
import PgBoss from 'pg-boss'
import { SOURCE_KEYS, type SourceAdapter, type SourceKey } from '@jio/core'
import { createDb, getLatestConfig, pingDb, type Db } from '@jio/db'
import { ADAPTERS } from './adapters'
import { loadWorkerEnv } from './env'
import { createLogger } from './log'
import { createPipelineDeps, registerPipelineJobs } from './jobs'
import { ensureQueues } from './queues'
import { runFetch, type Env, type RunOutcome, type RunnerDeps } from './runner'
import { startScheduler } from './scheduler'

export const FETCH_QUEUE = 'fetch-source'
/** Parallel fetch workers, so a slow Apify run never blocks RSS. */
export const FETCH_CONCURRENCY = 4
const SOURCE_SET: ReadonlySet<string> = new Set(SOURCE_KEYS)

export interface RunOnceOptions {
  db: Db
  env: Env
  adapters?: Record<SourceKey, SourceAdapter>
  concurrency?: number
  timeoutsMs?: RunnerDeps['timeoutsMs']
}

/**
 * Runs runFetch once for every enabled source, ignoring due logic and X routing (so both X
 * fixtures load). Outcomes come back in SOURCE_KEYS order. Used by `--once` and 07-01's demo.
 */
export async function runOnce(opts: RunOnceOptions): Promise<RunOutcome[]> {
  const { db, env, adapters = ADAPTERS, concurrency = FETCH_CONCURRENCY } = opts
  const { config } = await getLatestConfig(db)
  const keys = SOURCE_KEYS.filter((k) => config.sources[k].enabled)
  const deps: RunnerDeps = { db, env, adapters, timeoutsMs: opts.timeoutsMs }
  const results = new Map<SourceKey, RunOutcome>()
  let next = 0
  const lane = async () => {
    while (next < keys.length) {
      const key = keys[next++]!
      results.set(key, await runFetch(deps, key))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, keys.length)) }, lane))
  return keys.map((k) => results.get(k)!)
}

/** A plain-text table: source, mode, status, inserted, cost (and the error, if any). */
export function formatRunTable(outcomes: RunOutcome[]): string {
  const header = ['source', 'mode', 'status', 'inserted', 'cost', 'error']
  const rows = outcomes.map((o) => [
    o.sourceKey,
    o.mode,
    o.status,
    String(o.inserted),
    `$${o.costUsd.toFixed(4)}`,
    o.error ?? '',
  ])
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
  const line = (cells: string[]) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]!)))
      .join('  ')
      .trimEnd()
  const rule = widths.map((w) => '-'.repeat(w)).join('  ')
  return [line(header), rule, ...rows.map(line)].join('\n') + '\n'
}

/**
 * Returns an exit code for `--once`; for the long-running worker it returns undefined once
 * everything is started (the process then lives until SIGINT/SIGTERM).
 */
export async function main(argv: string[], env: Env = process.env): Promise<number | undefined> {
  const logger = createLogger({ level: env.LOG_LEVEL ?? 'info' })
  const { databaseUrl } = loadWorkerEnv(env)
  const { db, sql } = createDb(databaseUrl, { connectTimeoutSec: 5 })
  if (!(await pingDb(sql))) {
    logger.error('database unreachable')
    await sql.end({ timeout: 1 })
    return 1
  }

  if (argv.includes('--once')) {
    try {
      const outcomes = await runOnce({ db, env })
      console.log(formatRunTable(outcomes))
      return 0
    } finally {
      await sql.end({ timeout: 5 })
    }
  }

  const boss = new PgBoss({ connectionString: databaseUrl })
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))
  await boss.start()
  await ensureQueues(boss)
  // 'stately': at most one queued and one active job per singletonKey, so a long-running source
  // is never double-queued. ensureQueues created the queue with defaults; this sets the policy.
  await boss.updateQueue(FETCH_QUEUE, {
    name: FETCH_QUEUE,
    policy: 'stately',
    retryLimit: 0,
    expireInSeconds: 900,
  })

  const deps: RunnerDeps = { db, env, adapters: ADAPTERS }
  const handler = async (jobs: PgBoss.Job<{ sourceKey?: string }>[]) => {
    for (const job of jobs) {
      const key = job.data?.sourceKey
      if (!key || !SOURCE_SET.has(key)) {
        logger.warn({ jobId: job.id, data: job.data }, 'fetch-source job without a valid sourceKey')
        continue
      }
      const outcome = await runFetch(deps, key as SourceKey)
      logger.info({ ...outcome }, 'fetch run')
    }
  }
  // pg-boss 10 has no localConcurrency option: register the worker several times instead.
  for (let i = 0; i < FETCH_CONCURRENCY; i++) {
    await boss.work(FETCH_QUEUE, { batchSize: 1 }, handler)
  }
  await registerPipelineJobs(
    boss,
    { db, sql },
    await createPipelineDeps({ db, sql }, env, { log: logger }),
  )

  const scheduler = startScheduler({
    db,
    env,
    log: logger,
    enqueue: (sourceKey) =>
      boss.send(
        FETCH_QUEUE,
        { sourceKey },
        { singletonKey: sourceKey, retryLimit: 0, expireInSeconds: 900 },
      ),
  })
  logger.info({ sourcesMode: env.SOURCES_MODE ?? 'auto' }, 'worker ready')

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info({ signal }, 'worker stopping')
    scheduler.stop()
    try {
      await boss.stop({ graceful: true, wait: true, timeout: 30_000 })
      await sql.end({ timeout: 5 })
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'shutdown failed')
      process.exit(1)
    }
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  return undefined
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== undefined) process.exit(code)
    },
    (err) => {
      createLogger().error({ err }, 'worker boot failed')
      process.exit(1)
    },
  )
}
