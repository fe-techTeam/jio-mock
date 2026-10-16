// Portal adapters through the real runner against a test database: fixture rows land as fixture
// data, and a layout change opens the circuit instead of writing a wrong number.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import type { SourceAdapter, SourceKey } from '@jio/core'
import { schema, sourceHealth, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import { breakerState } from '../breaker'
import { runFetch } from '../runner'
import { createFakeFetch } from './_fixture'
import { ADAPTERS } from './index'
import { spec as chittorgarhSpec } from './portal-chittorgarh'
import { spec as investorgainSpec } from './portal-investorgain'
import { spec as ipowatchSpec } from './portal-ipowatch'
import { createPortalAdapter, type PortalSpec } from './portal-shared'

// No test in this file may reach the network.
vi.stubGlobal('fetch', createFakeFetch([]))

type PortalKey = 'portal_chittorgarh' | 'portal_investorgain' | 'portal_ipowatch'

const PORTALS: { key: PortalKey; spec: PortalSpec; gmp: number; total: number }[] = [
  { key: 'portal_chittorgarh', spec: chittorgarhSpec, gmp: 85, total: 5.37 },
  { key: 'portal_investorgain', spec: investorgainSpec, gmp: 82, total: 5.4 },
  { key: 'portal_ipowatch', spec: ipowatchSpec, gmp: 80, total: 5.3 },
]

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_portals')
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

const T0 = new Date('2026-10-16T09:00:00Z')
const clock = (d: Date) => () => new Date(d)
const deps = (adapters = ADAPTERS, now = T0) => ({ db, adapters, env: {}, now: clock(now) })

const pointsOf = (key: SourceKey) =>
  db.select().from(schema.marketPoints).where(eq(schema.marketPoints.sourceKey, key))
const postsOf = (key: SourceKey) =>
  db.select().from(schema.posts).where(eq(schema.posts.sourceKey, key))
const runsOf = (key: SourceKey) =>
  db
    .select()
    .from(schema.eventLog)
    .where(and(eq(schema.eventLog.kind, 'fetch_run'), eq(schema.eventLog.sourceKey, key)))
    .orderBy(asc(schema.eventLog.id))

describe.each(PORTALS)('$key through runFetch (fixture mode)', ({ key, gmp, total }) => {
  it('stores 5 fixture market points, media-lane fixture posts and one zero-cost fetch_run', async () => {
    const out = await runFetch(deps(), key, { modeOverride: 'fixture' })
    expect(out).toMatchObject({ status: 'ok', mode: 'fixture', marketPoints: 5, costUsd: 0 })

    const points = await pointsOf(key)
    expect(points).toHaveLength(5)
    expect(points.every((p) => p.sourceUrl.endsWith('#fixture'))).toBe(true)
    expect(points.find((p) => p.series === 'gmp_inr')?.value).toBe(gmp)
    expect(points.find((p) => p.series === 'sub_total_x')?.value).toBe(total)

    const posts = await postsOf(key)
    expect(posts.length).toBeGreaterThanOrEqual(2)
    expect(posts.every((p) => p.lane === 'media' && p.isFixture)).toBe(true)

    const runs = await runsOf(key)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'ok', itemsNew: posts.length })
    expect(Number(runs[0]!.costUsd)).toBe(0)
    expect(runs[0]!.detail).toMatchObject({ mode: 'fixture' })
  })

  it('a second run adds no posts and no duplicate points (same page time dedupes)', async () => {
    await runFetch(deps(), key, { modeOverride: 'fixture' })
    const postsBefore = (await postsOf(key)).length
    const second = await runFetch(deps(ADAPTERS, new Date(T0.getTime() + 600_000)), key, {
      modeOverride: 'fixture',
    })
    expect(second).toMatchObject({ status: 'ok', inserted: 0, marketPoints: 0 })
    expect(await pointsOf(key)).toHaveLength(5)
    expect(await postsOf(key)).toHaveLength(postsBefore)
  })
})

it('one fixture run of all three portals leaves 15 market points', async () => {
  for (const { key } of PORTALS) await runFetch(deps(), key, { modeOverride: 'fixture' })
  expect(await db.select().from(schema.marketPoints)).toHaveLength(15)
})

describe.each(PORTALS)('$key layout drift', ({ key, spec }) => {
  it('logs 3 error runs, opens the circuit and writes no market points', async () => {
    const drifted = readFileSync(
      new URL('./__fixtures__/portal/drifted.html', import.meta.url),
      'utf8',
    )
    const fake = createFakeFetch([[/.*/, () => new Response(drifted, { status: 200 })]])
    const adapters = { ...ADAPTERS, [key]: createPortalAdapter(spec, { fetch: fake }) } as Record<
      SourceKey,
      SourceAdapter
    >
    let now = T0
    for (let i = 0; i < 3; i++) {
      now = new Date(T0.getTime() + i * 60_000)
      const out = await runFetch(deps(adapters, now), key, { modeOverride: 'live' })
      expect(out.status).toBe('error')
      expect(out.error).toContain('GMP table not found')
    }
    const runs = await runsOf(key)
    expect(runs.map((r) => r.status)).toEqual(['error', 'error', 'error'])
    expect(await pointsOf(key)).toHaveLength(0)

    const row = (await sourceHealth(db, now)).find((h) => h.sourceKey === key)!
    expect(row.consecutiveFailures).toBe(3)
    expect(
      breakerState(
        { consecutiveFailures: row.consecutiveFailures, lastAttemptAt: row.lastRunAt },
        60,
        now,
      ),
    ).toBe('open')
  })
})
