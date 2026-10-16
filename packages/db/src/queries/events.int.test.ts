import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SOURCE_KEYS } from '@jio/core'
import { eventLog } from '../schema'
import { connectTestDb, testDatabaseUrl, truncateAll } from '../testing'
import { logEvent, loginFailuresSince, recentFetchRuns, sourceHealth } from './events'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

// 01:30 IST on 2026-10-17; IST midnight is 2026-10-16T18:30Z.
const NOW = new Date('2026-10-16T20:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000)

describe('logEvent', () => {
  it('truncates long errors and lowercases login actors only', async () => {
    await logEvent(db, {
      kind: 'fetch_run',
      sourceKey: 'x_api',
      status: 'error',
      error: 'e'.repeat(5000),
    })
    await logEvent(db, { kind: 'login_failed', actor: 'Strategy@Jio.Local', ip: '127.0.0.1' })
    await logEvent(db, { kind: 'config_change', actor: 'Mixed@Case', detail: { version: 1 } })
    const rows = await db.select().from(eventLog).orderBy(eventLog.id)
    expect(rows[0]!.error).toHaveLength(2000)
    expect(rows[0]!.detail).toEqual({})
    expect(rows[1]!.actor).toBe('strategy@jio.local')
    expect(rows[1]!.ip).toBe('127.0.0.1')
    expect(rows[2]!.actor).toBe('Mixed@Case')
    expect(rows[2]!.detail).toEqual({ version: 1 })
  })
})

describe('sourceHealth', () => {
  async function run(
    sourceKey: (typeof SOURCE_KEYS)[number],
    at: Date,
    status: 'ok' | 'error' | 'skipped',
    extra: { itemsNew?: number; costUsd?: number; error?: string } = {},
  ) {
    await logEvent(db, { kind: 'fetch_run', sourceKey, status, at, durationMs: 100, ...extra })
  }

  it('reports last success, last error and consecutive failures (skipped ignored)', async () => {
    await run('x_api', ago(180), 'ok', { itemsNew: 5, costUsd: 0.1 })
    await run('x_api', ago(120), 'error', { error: 'first failure' })
    await run('x_api', ago(90), 'skipped')
    await run('x_api', ago(60), 'error', { error: '429 Too Many Requests' })

    const rows = await sourceHealth(db, NOW)
    const x = rows.find((r) => r.sourceKey === 'x_api')!
    expect(x.consecutiveFailures).toBe(2)
    expect(x.lastError).toBe('429 Too Many Requests')
    expect(x.lastErrorAt).toEqual(ago(60))
    expect(x.lastSuccessAt).toEqual(ago(180))
    expect(x.lastRunAt).toEqual(ago(60))
    expect(x.lastStatus).toBe('error')
    expect(x.runs24h).toBe(4)
    expect(x.items24h).toBe(5)
    expect(x.spend24hUsd).toBeCloseTo(0.1)
  })

  it('splits spend at IST midnight and windows items to 24h', async () => {
    await run('youtube', new Date('2026-10-16T18:20:00Z'), 'ok', { costUsd: 1, itemsNew: 2 })
    await run('youtube', new Date('2026-10-16T18:40:00Z'), 'ok', { costUsd: 2, itemsNew: 3 })
    await run('youtube', ago(25 * 60), 'ok', { costUsd: 4, itemsNew: 100 })
    await run('youtube', ago(6 * 24 * 60), 'ok', { costUsd: 8 })
    await run('youtube', ago(8 * 24 * 60), 'ok', { costUsd: 16 })

    const y = (await sourceHealth(db, NOW)).find((r) => r.sourceKey === 'youtube')!
    expect(y.spendTodayUsd).toBeCloseTo(2)
    expect(y.spend24hUsd).toBeCloseTo(3)
    expect(y.spend7dUsd).toBeCloseTo(15)
    expect(y.items24h).toBe(5)
    expect(y.runs24h).toBe(2)
    expect(y.consecutiveFailures).toBe(0)
  })

  it('returns all 11 sources in SOURCE_KEYS order, with nulls and zeros for unseen ones', async () => {
    await run('portal_ipowatch', ago(5), 'ok')
    const rows = await sourceHealth(db, NOW)
    expect(rows.map((r) => r.sourceKey)).toEqual([...SOURCE_KEYS])
    expect(rows.find((r) => r.sourceKey === 'reddit')).toEqual({
      sourceKey: 'reddit',
      lastRunAt: null,
      lastStatus: null,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      runs24h: 0,
      items24h: 0,
      spend24hUsd: 0,
      spendTodayUsd: 0,
      spend7dUsd: 0,
      consecutiveFailures: 0,
    })
  })

  it('counts every error as consecutive when a source never succeeded', async () => {
    await run('reddit', ago(30), 'error', { error: 'a' })
    await run('reddit', ago(20), 'error', { error: 'b' })
    const r = (await sourceHealth(db, NOW)).find((x) => x.sourceKey === 'reddit')!
    expect(r.consecutiveFailures).toBe(2)
    expect(r.lastSuccessAt).toBeNull()
  })
})

describe('recentFetchRuns', () => {
  it('returns the newest runs first, limited', async () => {
    for (let i = 0; i < 12; i++) {
      await logEvent(db, {
        kind: 'fetch_run',
        sourceKey: 'news_rss',
        status: 'ok',
        at: ago(100 - i),
        itemsNew: i,
        costUsd: 0,
        durationMs: 10,
      })
    }
    await logEvent(db, { kind: 'fetch_run', sourceKey: 'reddit', status: 'ok', at: NOW })
    const runs = await recentFetchRuns(db, 'news_rss')
    expect(runs).toHaveLength(10)
    expect(runs[0]).toEqual({
      at: ago(89),
      status: 'ok',
      durationMs: 10,
      itemsNew: 11,
      costUsd: 0,
      error: null,
    })
    expect(await recentFetchRuns(db, 'news_rss', 3)).toHaveLength(3)
  })
})

describe('loginFailuresSince', () => {
  it('counts failures after the last successful login, newest first, case-insensitively', async () => {
    const email = 'Strategy@Jio.local'
    for (const m of [10, 9, 8])
      await logEvent(db, { kind: 'login_failed', actor: email, at: ago(m) })
    await logEvent(db, { kind: 'login', actor: email, at: ago(7) })
    for (const m of [6, 5]) await logEvent(db, { kind: 'login_failed', actor: email, at: ago(m) })
    await logEvent(db, { kind: 'login_failed', actor: 'other@jio.local', at: ago(4) })

    const dates = await loginFailuresSince(db, 'STRATEGY@jio.local', ago(15))
    expect(dates).toEqual([ago(5), ago(6)])
  })

  it('respects the since bound', async () => {
    for (const m of [20, 10, 5]) {
      await logEvent(db, { kind: 'login_failed', actor: 'a@b.c', at: ago(m) })
    }
    expect(await loginFailuresSince(db, 'a@b.c', ago(15))).toEqual([ago(5), ago(10)])
  })
})
