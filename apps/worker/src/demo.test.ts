import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MARKET_SERIES, SOURCE_KEYS } from '@jio/core'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { runDemo } from './demo'

vi.stubGlobal('fetch', () => {
  throw new Error('network in test')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_demo')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
})

const NOW = new Date('2026-10-16T08:00:00Z') // 13:30 IST Friday
const env = { ANTHROPIC_API_KEY: '', VOYAGE_API_KEY: '' }
const run = (extra: { purge?: boolean } = {}) =>
  runDemo({ db, sql, env, now: NOW, seed: 42, log: () => {}, ...extra })

describe('runDemo', () => {
  it('builds a realistic board from fixtures without any network or key', async () => {
    const snap = await run()

    for (const key of SOURCE_KEYS) {
      if (key.startsWith('portal_')) continue
      expect(snap.bySource[key], key).toBeGreaterThan(0)
    }
    for (const series of MARKET_SERIES) expect(snap.marketPoints[series], series).toBeGreaterThan(0)

    const active = snap.topics24h.filter((t) => t.items >= 10)
    expect(active.length).toBeGreaterThanOrEqual(3)
    expect(snap.topics24h.some((t) => t.items >= 30)).toBe(true)
    expect(snap.topics24h.some((t) => t.items >= 10 && t.items < 30)).toBe(true)
    expect(snap.unclassified).toBeGreaterThan(0)
    expect(snap.classified).toBeGreaterThan(0)
    expect(snap.suspectedCoordinated).toBeGreaterThanOrEqual(1)

    const runs = await sql<{ source_key: string; status: string }[]>`
      select source_key, status from event_log where kind = 'fetch_run'`
    for (const key of SOURCE_KEYS) {
      expect(
        runs.some((r) => r.source_key === key && r.status === 'ok'),
        key,
      ).toBe(true)
    }

    const buckets = await sql<{ recent: number; prior: number }[]>`
      select (count(distinct bucket_start) filter
                (where bucket_start > ${new Date(NOW.getTime() - 86_400_000).toISOString()}::timestamptz))::int
               as recent,
             (count(distinct bucket_start) filter
                (where bucket_start <= ${new Date(NOW.getTime() - 86_400_000).toISOString()}::timestamptz
                   and bucket_start > ${new Date(NOW.getTime() - 2 * 86_400_000).toISOString()}::timestamptz))::int
               as prior
      from topic_stats_15m`
    expect(buckets[0]!.recent).toBeGreaterThan(0)
    expect(buckets[0]!.prior).toBeGreaterThan(0)
  })

  it('is idempotent: a second run gives the same snapshot', async () => {
    const first = await run()
    const second = await run()
    expect(second).toEqual(first)
  })

  it('--purge leaves no fixture posts and keeps live rows', async () => {
    await run()
    await sql`insert into posts (source_key, external_id, url, lane, text, published_at)
      values ('reddit', 'live-1', 'https://example.test', 'social', 'live Jio IPO post', ${NOW.toISOString()}::timestamptz)`
    const snap = await run({ purge: true })
    expect(snap.posts).toBe(0)
    expect(await sql`select 1 from posts where is_fixture`).toHaveLength(0)
    expect(await sql`select 1 from posts where not is_fixture`).toHaveLength(1)
  })
})
