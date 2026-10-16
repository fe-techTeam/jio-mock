// pg-boss registration for the classification pipeline: queues, workers and cron schedules for
// classify-batch, rollup, summaries, emerging and retention. index.ts calls registerPipelineJobs
// once after pg-boss starts.
import type PgBoss from 'pg-boss'
import type { AppConfig } from '@jio/core'
import { getLatestConfig, logEvent } from '@jio/db'
import { runClassifyBatch } from './pipeline/classify-step'
import type { PipelineDeps, PipelineHandle } from './pipeline/deps'
import { runEmerging } from './pipeline/emerging'
import { runSummaries } from './pipeline/summaries'
import { retentionWindows, runRetention, type RetentionResult } from './retention'
import { runRollup, type RollupMode } from './rollup'

export { createPipelineDeps } from './pipeline/deps'

export const PIPELINE_QUEUES = [
  'classify-batch',
  'rollup',
  'summaries',
  'emerging',
  'retention',
] as const
export type PipelineQueue = (typeof PIPELINE_QUEUES)[number]

export const PIPELINE_SCHEDULES: Record<PipelineQueue, { cron: string; tz?: string }> = {
  'classify-batch': { cron: '* * * * *' },
  rollup: { cron: '* * * * *' },
  summaries: { cron: '*/30 * * * *' },
  emerging: { cron: '15,45 * * * *' },
  retention: { cron: '0 3 * * *', tz: 'Asia/Kolkata' },
}

/** 'stately': at most one queued and one active job per queue, so slow runs never pile up. */
export const PIPELINE_QUEUE_OPTIONS = {
  policy: 'stately',
  retryLimit: 1,
  expireInSeconds: 900,
} as const satisfies Omit<PgBoss.Queue, 'name'>

type JobLike = { id: string; data: unknown }

/** The subset of PgBoss used here (a fake in tests). */
export interface PipelineBoss {
  getQueue(name: string): Promise<unknown>
  createQueue(name: string, options: PgBoss.Queue): Promise<void>
  updateQueue(name: string, options: PgBoss.Queue): Promise<void>
  work(
    name: string,
    options: { batchSize: number },
    handler: (jobs: JobLike[]) => Promise<unknown>,
  ): Promise<string>
  schedule(
    name: string,
    cron: string,
    data?: object,
    options?: PgBoss.ScheduleOptions,
  ): Promise<void>
  send(name: string, data: object): Promise<string | null>
}

export type PipelineJobFns = {
  classifyBatch: (h: PipelineHandle, deps: PipelineDeps) => Promise<unknown>
  rollup: (h: PipelineHandle, now: Date, opts: { mode?: RollupMode }) => Promise<unknown>
  summaries: (h: PipelineHandle, deps: PipelineDeps, now: Date) => Promise<unknown>
  emerging: (h: PipelineHandle, deps: PipelineDeps, now: Date) => Promise<unknown>
  retention: (
    h: PipelineHandle,
    now: Date,
    windows: ReturnType<typeof retentionWindows>,
  ) => Promise<unknown>
  loadConfig: (h: PipelineHandle) => Promise<AppConfig>
  logRetention: (h: PipelineHandle, result: unknown) => Promise<void>
}

export const DEFAULT_PIPELINE_FNS: PipelineJobFns = {
  classifyBatch: (h, deps) => runClassifyBatch(h, deps),
  rollup: (h, now, opts) => runRollup(h, now, opts),
  summaries: (h, deps, now) => runSummaries(h, deps, now),
  emerging: (h, deps, now) => runEmerging(h, deps, now),
  retention: (h, now, windows) => runRetention(h, now, windows),
  loadConfig: async (h) => (await getLatestConfig(h.db)).config,
  logRetention: (h, result) =>
    logEvent(h.db, { kind: 'retention', detail: { ...(result as RetentionResult) } }),
}

function rollupMode(data: unknown): RollupMode | undefined {
  const mode = (data as { mode?: unknown } | null)?.mode
  return mode === 'recent' || mode === 'full7d' ? mode : undefined
}

export async function registerPipelineJobs(
  boss: PipelineBoss,
  h: PipelineHandle,
  deps: PipelineDeps,
  fns: PipelineJobFns = DEFAULT_PIPELINE_FNS,
): Promise<void> {
  const run: Record<PipelineQueue, (job: JobLike) => Promise<unknown>> = {
    'classify-batch': () => fns.classifyBatch(h, deps),
    rollup: (job) => fns.rollup(h, new Date(), { mode: rollupMode(job.data) }),
    summaries: () => fns.summaries(h, deps, new Date()),
    emerging: () => fns.emerging(h, deps, new Date()),
    retention: async () => {
      const windows = retentionWindows(await fns.loadConfig(h))
      const result = await fns.retention(h, new Date(), windows)
      await fns.logRetention(h, result)
      return result
    },
  }

  for (const name of PIPELINE_QUEUES) {
    const options = { name, ...PIPELINE_QUEUE_OPTIONS }
    if (await boss.getQueue(name)) await boss.updateQueue(name, options)
    else await boss.createQueue(name, options)
  }

  for (const name of PIPELINE_QUEUES) {
    await boss.work(name, { batchSize: 1 }, async (jobs) => {
      for (const job of jobs) {
        const started = Date.now()
        try {
          const result = await run[name](job)
          deps.log.info(
            { queue: name, jobId: job.id, durationMs: Date.now() - started, result },
            `${name} job done`,
          )
        } catch (err) {
          deps.log.error({ err, queue: name, jobId: job.id }, `${name} job failed`)
          throw err
        }
      }
    })
  }

  for (const name of PIPELINE_QUEUES) {
    const { cron, tz } = PIPELINE_SCHEDULES[name]
    await boss.schedule(name, cron, undefined, tz ? { tz } : undefined)
  }

  // A restart repairs the last 7 days of rollups.
  await boss.send('rollup', { mode: 'full7d' })
}
