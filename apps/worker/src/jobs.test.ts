import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import type { Db } from '@jio/db'
import { HashingEmbedder } from './classify/embed-stub'
import { StubClassifier } from './classify/stub'
import {
  PIPELINE_QUEUES,
  PIPELINE_SCHEDULES,
  registerPipelineJobs,
  type PipelineJobFns,
} from './jobs'
import type { PipelineDeps } from './pipeline/deps'
import { StubSummarizer } from './pipeline/summarizer'
import type { Sql } from './triage/repo'

type Handler = (jobs: { id: string; data: unknown }[]) => Promise<unknown>

function fakeBoss(existing: string[] = []) {
  const calls = {
    getQueue: [] as string[],
    createQueue: [] as [string, unknown][],
    updateQueue: [] as [string, unknown][],
    work: [] as [string, unknown][],
    schedule: [] as [string, string, unknown, unknown][],
    send: [] as [string, unknown][],
  }
  const handlers = new Map<string, Handler>()
  const boss = {
    getQueue: async (name: string) => {
      calls.getQueue.push(name)
      return existing.includes(name) ? { name } : null
    },
    createQueue: async (name: string, opts: unknown) => {
      calls.createQueue.push([name, opts])
    },
    updateQueue: async (name: string, opts: unknown) => {
      calls.updateQueue.push([name, opts])
    },
    work: async (name: string, opts: unknown, handler: Handler) => {
      calls.work.push([name, opts])
      handlers.set(name, handler)
      return `w-${name}`
    },
    schedule: async (name: string, cron: string, data: unknown, opts: unknown) => {
      calls.schedule.push([name, cron, data, opts])
    },
    send: async (name: string, data: unknown) => {
      calls.send.push([name, data])
      return 'job-1'
    },
  }
  return { boss, calls, handlers }
}

const h = { db: {} as Db, sql: {} as Sql }
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const deps: PipelineDeps = {
  classifier: new StubClassifier({ terms: structuredClone(DEFAULT_CONFIG.terms) }),
  embedder: new HashingEmbedder(),
  summarizer: new StubSummarizer(),
  log,
}

type FnMocks = { [K in keyof PipelineJobFns]: ReturnType<typeof vi.fn> }

function fns(): FnMocks {
  return {
    classifyBatch: vi.fn(async () => ({ classified: 1 })),
    rollup: vi.fn(async () => ({ mode: 'recent' })),
    summaries: vi.fn(async () => ({ summarized: 1 })),
    emerging: vi.fn(async () => ({ created: 0 })),
    retention: vi.fn(async () => ({ postsDeleted: 0 })),
    loadConfig: vi.fn(async () => structuredClone(DEFAULT_CONFIG)),
    logRetention: vi.fn(async () => {}),
  }
}
const asFns = (f: FnMocks) => f as unknown as PipelineJobFns

describe('registerPipelineJobs', () => {
  it('creates stately queues, workers and the exact cron schedules, then queues a full7d rollup', async () => {
    const { boss, calls } = fakeBoss(['rollup'])
    await registerPipelineJobs(boss, h, deps, asFns(fns()))

    expect(PIPELINE_QUEUES).toEqual([
      'classify-batch',
      'rollup',
      'summaries',
      'emerging',
      'retention',
    ])
    const policy = { policy: 'stately', retryLimit: 1, expireInSeconds: 900 }
    expect(calls.createQueue).toEqual(
      ['classify-batch', 'summaries', 'emerging', 'retention'].map((n) => [
        n,
        { name: n, ...policy },
      ]),
    )
    // A queue that already exists (index.ts ensureQueues) gets the same options via updateQueue.
    expect(calls.updateQueue).toEqual([['rollup', { name: 'rollup', ...policy }]])
    expect(calls.work).toEqual(PIPELINE_QUEUES.map((n) => [n, { batchSize: 1 }]))
    expect(calls.schedule).toEqual([
      ['classify-batch', '* * * * *', undefined, undefined],
      ['rollup', '* * * * *', undefined, undefined],
      ['summaries', '*/30 * * * *', undefined, undefined],
      ['emerging', '15,45 * * * *', undefined, undefined],
      ['retention', '0 3 * * *', undefined, { tz: 'Asia/Kolkata' }],
    ])
    expect(PIPELINE_SCHEDULES.retention).toEqual({ cron: '0 3 * * *', tz: 'Asia/Kolkata' })
    expect(calls.send).toEqual([['rollup', { mode: 'full7d' }]])
  })

  it('each handler calls its injected function', async () => {
    const { boss, handlers } = fakeBoss()
    const f = fns()
    await registerPipelineJobs(boss, h, deps, asFns(f))

    await handlers.get('classify-batch')!([{ id: '1', data: {} }])
    expect(f.classifyBatch).toHaveBeenCalledWith(h, deps)

    await handlers.get('rollup')!([{ id: '2', data: { mode: 'full7d' } }])
    expect(f.rollup).toHaveBeenCalledWith(h, expect.any(Date), { mode: 'full7d' })
    await handlers.get('rollup')!([{ id: '3', data: { mode: 'bogus' } }])
    expect(f.rollup).toHaveBeenLastCalledWith(h, expect.any(Date), { mode: undefined })

    await handlers.get('summaries')!([{ id: '4', data: {} }])
    expect(f.summaries).toHaveBeenCalledWith(h, deps, expect.any(Date))

    await handlers.get('emerging')!([{ id: '5', data: {} }])
    expect(f.emerging).toHaveBeenCalledWith(h, deps, expect.any(Date))

    await handlers.get('retention')!([{ id: '6', data: {} }])
    expect(f.loadConfig).toHaveBeenCalledWith(h)
    expect(f.retention).toHaveBeenCalledWith(h, expect.any(Date), {
      rawJsonDays: 30,
      postDays: 90,
      authorDays: 90,
    })
    expect(f.logRetention).toHaveBeenCalledWith(h, { postsDeleted: 0 })
  })

  it('a handler error is logged and propagates so pg-boss records the failure', async () => {
    const { boss, handlers } = fakeBoss()
    const f = fns()
    f.emerging.mockRejectedValueOnce(new Error('boom'))
    await registerPipelineJobs(boss, h, deps, asFns(f))
    await expect(handlers.get('emerging')!([{ id: '7', data: {} }])).rejects.toThrow('boom')
    expect(log.error).toHaveBeenCalled()
  })
})
