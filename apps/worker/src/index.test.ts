import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { SOURCE_KEYS } from '@jio/core'
import { schema, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import { createFakeFetch } from './adapters/_fixture'
import { formatRunTable, main, runOnce } from './index'

vi.stubGlobal('fetch', createFakeFetch([]))

const NON_PORTAL = SOURCE_KEYS.filter((k) => !k.startsWith('portal_'))
const PORTAL = SOURCE_KEYS.filter((k) => k.startsWith('portal_'))

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']
let url: string

beforeAll(async () => {
  url = await prepareTestDb('jio_ipo_test_worker_index')
  ;({ db, sql } = connectTestDb(url))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

beforeEach(async () => {
  await sql.unsafe(
    'truncate table posts, authors, event_log, market_points, config_versions restart identity cascade',
  )
})

async function postCountsBySource() {
  const rows = await db
    .select({ sourceKey: schema.posts.sourceKey, n: dsql<number>`count(*)::int` })
    .from(schema.posts)
    .groupBy(schema.posts.sourceKey)
  return Object.fromEntries(rows.map((r) => [r.sourceKey, r.n]))
}

const fetchRunCount = async () =>
  (await db.select().from(schema.eventLog).where(eq(schema.eventLog.kind, 'fetch_run'))).length

describe('runOnce', () => {
  it('fills posts from all 11 fixtures (portals add media-lane news links) and logs 11 fetch_runs; a rerun inserts nothing', async () => {
    const first = await runOnce({ db, env: { SOURCES_MODE: 'fixture' } })
    expect(first.map((o) => o.sourceKey)).toEqual([...SOURCE_KEYS])
    expect(first.every((o) => o.status === 'ok' && o.mode === 'fixture')).toBe(true)

    const counts = await postCountsBySource()
    expect(Object.keys(counts).sort()).toEqual([...SOURCE_KEYS].sort())
    for (const k of NON_PORTAL) expect(counts[k], k).toBeGreaterThanOrEqual(10)
    // PLAN-02-04: each portal fixture yields at least 2 Jio IPO news links as media-lane posts.
    for (const k of PORTAL) expect(counts[k], k).toBeGreaterThanOrEqual(2)
    expect(await fetchRunCount()).toBe(11)

    const fixtureFlags = await db.select({ f: schema.posts.isFixture }).from(schema.posts)
    expect(fixtureFlags.every((r) => r.f)).toBe(true)

    const second = await runOnce({ db, env: { SOURCES_MODE: 'fixture' } })
    expect(second.reduce((s, o) => s + o.inserted, 0)).toBe(0)
    expect(second.every((o) => o.status === 'ok')).toBe(true)
    expect(await fetchRunCount()).toBe(22)
  })

  it('stores media-outlet fixture posts in the media lane', async () => {
    await runOnce({ db, env: { SOURCES_MODE: 'fixture' } })
    const rows = await db
      .select({ lane: schema.posts.lane, n: dsql<number>`count(*)::int` })
      .from(schema.posts)
      .where(eq(schema.posts.sourceKey, 'news_rss'))
      .groupBy(schema.posts.lane)
    expect(rows).toEqual([{ lane: 'media', n: 15 }])
  })
})

describe('formatRunTable', () => {
  it('prints one row per source with mode, status, inserted and cost', () => {
    const table = formatRunTable([
      {
        sourceKey: 'reddit',
        status: 'ok',
        mode: 'fixture',
        fetched: 20,
        inserted: 20,
        duplicates: 0,
        marketPoints: 0,
        costUsd: 0,
        durationMs: 12,
      },
      {
        sourceKey: 'x_api',
        status: 'error',
        mode: 'unconfigured',
        fetched: 0,
        inserted: 0,
        duplicates: 0,
        marketPoints: 0,
        costUsd: 0.0123,
        durationMs: 3,
        error: 'not configured: missing X_BEARER_TOKEN',
      },
    ])
    const lines = table.trim().split('\n')
    expect(lines[0]).toMatch(/source\s+mode\s+status\s+inserted\s+cost/)
    expect(lines).toHaveLength(4) // header, rule, 2 rows
    expect(lines[2]).toMatch(/^reddit\s+fixture\s+ok\s+20\s+\$0\.0000/)
    expect(lines[3]).toContain('not configured: missing X_BEARER_TOKEN')
  })
})

describe('main --once', () => {
  it('runs every enabled source once, prints the table and returns 0', async () => {
    const out: string[] = []
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((s: unknown) => void out.push(String(s)))
    try {
      const code = await main(['--once'], {
        DATABASE_URL: url,
        SOURCES_MODE: 'fixture',
        LOG_LEVEL: 'silent',
      })
      expect(code).toBe(0)
    } finally {
      spy.mockRestore()
    }
    const printed = out.join('\n')
    for (const k of SOURCE_KEYS) expect(printed).toContain(k)
    expect(await fetchRunCount()).toBe(11)
  })
})
