import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import pino from 'pino'
import { DEFAULT_CONFIG, SOURCE_KEYS, type AppConfig, type SourceKey } from '@jio/core'
import { logEvent, saveConfigVersion, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import { createFakeFetch } from './adapters/_fixture'
import {
  effectiveIntervalMin,
  isDue,
  latestRuns,
  planTick,
  startScheduler,
  type LatestRun,
  type PlanTickInput,
  type ResolvedMode,
  type SkipReason,
} from './scheduler'

// 2026-10-19 is a Monday; IST = UTC + 05:30.
const MON_0915_IST = new Date('2026-10-19T03:45:00Z')
const MON_0914_IST = new Date('2026-10-19T03:44:00Z')
const MON_1531_IST = new Date('2026-10-19T10:01:00Z')
const SAT_1100_IST = new Date('2026-10-17T05:30:00Z')
const NOW = new Date('2026-10-19T06:00:00Z') // Monday 11:30 IST

const minsBefore = (d: Date, m: number) => new Date(d.getTime() - m * 60_000)

function config(mut?: (c: AppConfig) => void): AppConfig {
  const c = structuredClone(DEFAULT_CONFIG)
  mut?.(c)
  return c
}

const LIVE: ResolvedMode = { mode: 'live' }
const FIXTURE_FORCED: ResolvedMode = { mode: 'fixture', reason: 'sources_mode' }
const FIXTURE_NO_CREDS: ResolvedMode = {
  mode: 'fixture',
  reason: 'missing_creds',
  missing: ['X_BEARER_TOKEN'],
}
const UNCONFIGURED: ResolvedMode = { mode: 'unconfigured', missing: ['X_BEARER_TOKEN'] }

function modes(overrides: Partial<Record<SourceKey, ResolvedMode>> = {}) {
  const m = Object.fromEntries(SOURCE_KEYS.map((k) => [k, FIXTURE_FORCED])) as Record<
    SourceKey,
    ResolvedMode
  >
  return { ...m, ...overrides }
}

function input(over: Partial<PlanTickInput> = {}): PlanTickInput {
  return {
    now: NOW,
    config: config(),
    runs: [],
    health: SOURCE_KEYS.map((sourceKey) => ({ sourceKey, consecutiveFailures: 0 })),
    modes: modes(),
    ...over,
  }
}

function reasonFor(out: ReturnType<typeof planTick>, key: SourceKey): SkipReason | 'enqueued' {
  if (out.enqueue.includes(key)) return 'enqueued'
  const s = out.skipped.find((x) => x.key === key)
  if (!s) throw new Error(`${key} neither enqueued nor skipped`)
  return s.reason
}

const run = (sourceKey: SourceKey, at: Date, status = 'ok', detail = {}): LatestRun => ({
  sourceKey,
  at,
  status,
  detail,
})

describe('isDue', () => {
  it('is due when never run', () => {
    expect(isDue(null, 5, NOW)).toBe(true)
  })
  it('is not due 4 minutes into a 5 minute interval', () => {
    expect(isDue(minsBefore(NOW, 4), 5, NOW)).toBe(false)
  })
  it('is due at 5 minutes', () => {
    expect(isDue(minsBefore(NOW, 5), 5, NOW)).toBe(true)
  })
})

describe('effectiveIntervalMin', () => {
  const portal = DEFAULT_CONFIG.sources.portal_chittorgarh
  it('uses the market-hours interval for a portal at 09:15 IST on Monday', () => {
    expect(effectiveIntervalMin('portal_chittorgarh', portal, MON_0915_IST)).toBe(10)
  })
  it('uses the normal interval at 09:14 IST', () => {
    expect(effectiveIntervalMin('portal_chittorgarh', portal, MON_0914_IST)).toBe(60)
  })
  it('uses the normal interval at 15:31 IST', () => {
    expect(effectiveIntervalMin('portal_investorgain', portal, MON_1531_IST)).toBe(60)
  })
  it('uses the normal interval on Saturday 11:00 IST', () => {
    expect(effectiveIntervalMin('portal_ipowatch', portal, SAT_1100_IST)).toBe(60)
  })
  it('uses interval_min for a source without a market-hours interval', () => {
    expect(effectiveIntervalMin('reddit', DEFAULT_CONFIG.sources.reddit, MON_0915_IST)).toBe(5)
  })
})

describe('planTick', () => {
  it('enqueues a never-run source', () => {
    expect(reasonFor(planTick(input()), 'reddit')).toBe('enqueued')
  })

  it('does not enqueue a source run 4 minutes ago with a 5 minute interval', () => {
    const out = planTick(input({ runs: [run('reddit', minsBefore(NOW, 4))] }))
    expect(reasonFor(out, 'reddit')).toBe('not_due')
  })

  it('enqueues it at 5 minutes', () => {
    const out = planTick(input({ runs: [run('reddit', minsBefore(NOW, 5))] }))
    expect(reasonFor(out, 'reddit')).toBe('enqueued')
  })

  it('skips a disabled source', () => {
    const out = planTick(input({ config: config((c) => (c.sources.youtube.enabled = false)) }))
    expect(reasonFor(out, 'youtube')).toBe('disabled')
  })

  it('polls a portal every 10 minutes during market hours', () => {
    const out = planTick(
      input({ now: MON_0915_IST, runs: [run('portal_chittorgarh', minsBefore(MON_0915_IST, 10))] }),
    )
    expect(reasonFor(out, 'portal_chittorgarh')).toBe('enqueued')
  })

  it('polls a portal hourly at 15:31 IST', () => {
    const out = planTick(
      input({ now: MON_1531_IST, runs: [run('portal_chittorgarh', minsBefore(MON_1531_IST, 10))] }),
    )
    expect(reasonFor(out, 'portal_chittorgarh')).toBe('not_due')
  })

  it('polls a portal hourly on Saturday', () => {
    const out = planTick(
      input({ now: SAT_1100_IST, runs: [run('portal_ipowatch', minsBefore(SAT_1100_IST, 30))] }),
    )
    expect(reasonFor(out, 'portal_ipowatch')).toBe('not_due')
  })

  it('skips a source whose circuit is open', () => {
    const out = planTick(
      input({
        runs: [run('reddit', minsBefore(NOW, 6), 'error')],
        health: [{ sourceKey: 'reddit', consecutiveFailures: 4 }], // cooldown 10 min
      }),
    )
    expect(reasonFor(out, 'reddit')).toBe('circuit_open')
  })

  it('enqueues a half_open source', () => {
    const out = planTick(
      input({
        runs: [run('reddit', minsBefore(NOW, 11), 'error')],
        health: [{ sourceKey: 'reddit', consecutiveFailures: 4 }],
      }),
    )
    expect(reasonFor(out, 'reddit')).toBe('enqueued')
  })

  it('skips a source rate-limited into the future', () => {
    const until = new Date(NOW.getTime() + 10 * 60_000).toISOString()
    const out = planTick(
      input({
        runs: [run('youtube', minsBefore(NOW, 60), 'rate_limited', { rateLimitedUntil: until })],
      }),
    )
    expect(reasonFor(out, 'youtube')).toBe('rate_limited')
  })

  it('enqueues a source once its rate limit has expired', () => {
    const until = minsBefore(NOW, 1).toISOString()
    const out = planTick(
      input({
        runs: [run('youtube', minsBefore(NOW, 60), 'rate_limited', { rateLimitedUntil: until })],
      }),
    )
    expect(reasonFor(out, 'youtube')).toBe('enqueued')
  })

  it('skips an unconfigured non-X source', () => {
    const out = planTick(
      input({
        modes: modes({ apify_instagram: { mode: 'unconfigured', missing: ['APIFY_TOKEN'] } }),
      }),
    )
    expect(reasonFor(out, 'apify_instagram')).toBe('unconfigured')
  })

  describe('X routing', () => {
    it('SOURCES_MODE=fixture: x_api runs, x_apify skipped x_primary_active', () => {
      const out = planTick(input({ modes: modes({ x_api: FIXTURE_FORCED }) }))
      expect(reasonFor(out, 'x_api')).toBe('enqueued')
      expect(reasonFor(out, 'x_apify')).toBe('x_primary_active')
    })

    it('x_api live and not rate-limited: x_api runs, x_apify skipped x_primary_active', () => {
      const out = planTick(input({ modes: modes({ x_api: LIVE, x_apify: LIVE }) }))
      expect(reasonFor(out, 'x_api')).toBe('enqueued')
      expect(reasonFor(out, 'x_apify')).toBe('x_primary_active')
    })

    it('x_api live but rate-limited: x_api skipped rate_limited, x_apify runs', () => {
      const until = new Date(NOW.getTime() + 15 * 60_000).toISOString()
      const out = planTick(
        input({
          modes: modes({ x_api: LIVE, x_apify: LIVE }),
          runs: [run('x_api', minsBefore(NOW, 3), 'rate_limited', { rateLimitedUntil: until })],
        }),
      )
      expect(reasonFor(out, 'x_api')).toBe('rate_limited')
      expect(reasonFor(out, 'x_apify')).toBe('enqueued')
    })

    it('x_api fixture for lack of a token: x_api skipped x_primary_inactive, x_apify runs', () => {
      const out = planTick(input({ modes: modes({ x_api: FIXTURE_NO_CREDS, x_apify: LIVE }) }))
      expect(reasonFor(out, 'x_api')).toBe('x_primary_inactive')
      expect(reasonFor(out, 'x_apify')).toBe('enqueued')
    })

    it('x_api unconfigured: x_api skipped x_primary_inactive, x_apify runs', () => {
      const out = planTick(input({ modes: modes({ x_api: UNCONFIGURED, x_apify: LIVE }) }))
      expect(reasonFor(out, 'x_api')).toBe('x_primary_inactive')
      expect(reasonFor(out, 'x_apify')).toBe('enqueued')
    })

    it('x_api disabled: x_apify runs', () => {
      const out = planTick(
        input({
          modes: modes({ x_api: LIVE, x_apify: LIVE }),
          config: config((c) => (c.sources.x_api.enabled = false)),
        }),
      )
      expect(reasonFor(out, 'x_api')).toBe('disabled')
      expect(reasonFor(out, 'x_apify')).toBe('enqueued')
    })

    it('x_apify still obeys its own due logic when it is the active X route', () => {
      const out = planTick(
        input({
          modes: modes({ x_api: FIXTURE_NO_CREDS, x_apify: LIVE }),
          runs: [run('x_apify', minsBefore(NOW, 3))],
        }),
      )
      expect(reasonFor(out, 'x_apify')).toBe('not_due')
    })
  })

  it('accounts for every source exactly once', () => {
    const out = planTick(input())
    const all = [...out.enqueue, ...out.skipped.map((s) => s.key)].sort()
    expect(all).toEqual([...SOURCE_KEYS].sort())
  })
})

// ------------------------------------------------------------------------------------------------
// Integration: the scheduler loop against a dedicated test database.

describe('scheduler loop', () => {
  let db: Db
  let sql: ReturnType<typeof connectTestDb>['sql']
  const log = pino({ level: 'silent' })
  const env = { SOURCES_MODE: 'fixture' }

  beforeAll(async () => {
    vi.stubGlobal('fetch', createFakeFetch([]))
    const url = await prepareTestDb('jio_ipo_test_worker_scheduler')
    ;({ db, sql } = connectTestDb(url))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await sql?.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await sql.unsafe(
      'truncate table posts, authors, event_log, market_points, config_versions restart identity cascade',
    )
    await saveConfigVersion(db, DEFAULT_CONFIG, 'test')
  })

  const seedOkRuns = async (at: Date) => {
    for (const sourceKey of SOURCE_KEYS) {
      await logEvent(db, {
        kind: 'fetch_run',
        at,
        sourceKey,
        status: 'ok',
        itemsNew: 0,
        detail: { mode: 'fixture' },
      })
    }
  }

  it('latestRuns returns the newest fetch_run per source', async () => {
    const t1 = new Date(Date.now() - 600_000)
    const t2 = new Date(Date.now() - 60_000)
    await logEvent(db, { kind: 'fetch_run', at: t1, sourceKey: 'reddit', status: 'ok' })
    await logEvent(db, {
      kind: 'fetch_run',
      at: t2,
      sourceKey: 'reddit',
      status: 'error',
      detail: { mode: 'live' },
    })
    await logEvent(db, { kind: 'fetch_run', at: t1, sourceKey: 'youtube', status: 'ok' })
    await logEvent(db, { kind: 'login', actor: 'a@b.c' })
    const runs = await latestRuns(db)
    expect(runs.map((r) => [r.sourceKey, r.status, r.at.getTime()]).sort()).toEqual(
      [
        ['reddit', 'error', t2.getTime()],
        ['youtube', 'ok', t1.getTime()],
      ].sort(),
    )
    expect(runs.find((r) => r.sourceKey === 'reddit')!.detail).toEqual({ mode: 'live' })
  })

  it('first tick enqueues every enabled source except x_apify; a second tick after fresh runs enqueues nothing', async () => {
    const enqueue = vi.fn(async (_key: SourceKey) => {})
    const sched = startScheduler({ db, env, enqueue, log, immediate: false })
    try {
      const first = await sched.tick()
      const expected = SOURCE_KEYS.filter((k) => k !== 'x_apify')
      expect(first?.enqueue.sort()).toEqual([...expected].sort())
      expect(enqueue.mock.calls.map(([k]) => k).sort()).toEqual([...expected].sort())
      expect(first?.skipped).toEqual([{ key: 'x_apify', reason: 'x_primary_active' }])

      await seedOkRuns(new Date())
      enqueue.mockClear()
      const second = await sched.tick()
      expect(second?.enqueue).toEqual([])
      expect(enqueue).not.toHaveBeenCalled()
    } finally {
      sched.stop()
    }
  })

  it('skips disabled sources from the saved config', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG)
    cfg.sources.reddit.enabled = false
    await saveConfigVersion(db, cfg, 'test')
    const enqueue = vi.fn(async () => {})
    const sched = startScheduler({ db, env, enqueue, log, immediate: false })
    const plan = await sched.tick()
    sched.stop()
    expect(plan?.enqueue).not.toContain('reddit')
    expect(plan?.skipped).toContainEqual({ key: 'reddit', reason: 'disabled' })
  })

  it('never overlaps ticks: a slow tick makes the next one skip', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const enqueue = vi.fn(async () => gate)
    const sched = startScheduler({ db, env, enqueue, log, immediate: false })
    try {
      const slow = sched.tick()
      await vi.waitFor(() => expect(enqueue).toHaveBeenCalled())
      await expect(sched.tick()).resolves.toBeNull()
      release()
      const plan = await slow
      expect(plan?.enqueue.length).toBe(10)
      expect(enqueue).toHaveBeenCalledTimes(10)
    } finally {
      sched.stop()
    }
  })

  it('keeps enqueuing after one enqueue fails', async () => {
    const enqueue = vi.fn(async (key: SourceKey) => {
      if (key === 'x_api') throw new Error('queue down')
    })
    const sched = startScheduler({ db, env, enqueue, log, immediate: false })
    const plan = await sched.tick()
    sched.stop()
    expect(plan?.enqueue.length).toBe(10)
    expect(enqueue).toHaveBeenCalledTimes(10)
  })

  it('ticks once at start and then every intervalMs until stopped', async () => {
    const enqueue = vi.fn(async () => {})
    const ticks: number[] = []
    const sched = startScheduler({
      db,
      env,
      enqueue,
      log,
      intervalMs: 40,
      onTick: () => ticks.push(Date.now()),
    })
    await vi.waitFor(() => expect(ticks.length).toBeGreaterThanOrEqual(3), { timeout: 5000 })
    sched.stop()
    const n = ticks.length
    await new Promise((r) => setTimeout(r, 120))
    expect(ticks.length).toBeLessThanOrEqual(n + 1)
  })
})
