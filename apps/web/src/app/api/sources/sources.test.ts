// @vitest-environment node
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { seedBase, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import type { Sql } from 'postgres'

const NOW = new Date('2026-10-16T08:00:00Z') // Friday 13:30 IST, market hours
const holder = vi.hoisted(() => ({ ctx: null as unknown }))

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/queries/ctx', () => ({
  readCtx: () => holder.ctx,
}))

import { auth } from '@/lib/auth'
import type { SourcesResponse } from './_lib/contract'
import { GET, PATCH } from './route'
import { GET as GET_RUNS } from './[key]/runs/route'

let db: Db
let sql: Sql
const getSession = vi.mocked(auth.api.getSession)
const SESSION = { user: { email: 'a@b.c' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const KEY = randomBytes(32).toString('base64')
const TOKEN = 'SECRETTOKEN-abcdefghijklmnop-123456'

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_sources')
  ;({ db, sql } = connectTestDb(url))
  holder.ctx = { db, sql, now: NOW }
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  await seedBase(db)
  getSession.mockReset().mockResolvedValue(SESSION)
  vi.stubEnv('SOURCES_MODE', 'auto')
  vi.stubEnv('CONFIG_ENCRYPTION_KEY', KEY)
  for (const k of [
    'X_BEARER_TOKEN',
    'APIFY_TOKEN',
    'YOUTUBE_API_KEY',
    'REDDIT_CLIENT_ID',
    'REDDIT_CLIENT_SECRET',
    'SERPER_API_KEY',
  ])
    vi.stubEnv(k, '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

async function run(
  key: string,
  minAgo: number,
  status: 'ok' | 'error' | 'rate_limited',
  extra: { items?: number; cost?: number; detail?: object; error?: string } = {},
) {
  const at = new Date(NOW.getTime() - minAgo * 60_000).toISOString()
  await sql`insert into event_log (at, kind, source_key, status, items_new, cost_usd, duration_ms, error, detail)
    values (${at}::timestamptz, 'fetch_run', ${key}, ${status}, ${extra.items ?? 0}, ${extra.cost ?? 0}, 1200,
      ${extra.error ?? null}, ${JSON.stringify(extra.detail ?? {})}::jsonb)`
}

const get = async (): Promise<SourcesResponse> =>
  (await GET(new Request('http://x/api/sources'), {})).json()
const patch = (body: unknown) =>
  PATCH(
    new Request('http://x/api/sources', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    {},
  )

describe('GET /api/sources', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET(new Request('http://x/api/sources'), {})).status).toBe(401)
  })

  it('returns 11 rows in fixed order with status, mode and nextRunAt', async () => {
    await run('reddit', 5, 'ok', { items: 4, cost: 0.1 })
    await run('news_rss', 500, 'ok')
    for (const m of [30, 20, 10]) await run('web_search', m, 'error', { error: 'boom' })
    const body = await get()
    expect(body.sources.map((s) => s.key)).toEqual([
      'x_api',
      'x_apify',
      'reddit',
      'news_rss',
      'web_search',
      'youtube',
      'apify_instagram',
      'apify_linkedin',
      'portal_chittorgarh',
      'portal_investorgain',
      'portal_ipowatch',
    ])
    const by = Object.fromEntries(body.sources.map((s) => [s.key, s]))
    expect(by.reddit).toMatchObject({ status: 'ok', mode: 'fixture', items24h: 4 })
    expect(by.reddit!.missingCreds).toEqual(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'])
    expect(by.reddit!.nextRunAt).toBe(
      new Date(NOW.getTime() - 5 * 60_000 + by.reddit!.effectiveIntervalMin * 60_000).toISOString(),
    )
    expect(by.news_rss!.status).toBe('stale')
    expect(by.web_search).toMatchObject({ status: 'circuit_open', consecutiveFailures: 3 })
    expect(by.web_search!.lastError).toBe('boom')
    expect(by.youtube!.status).toBe('waiting')
    expect(by.youtube!.nextRunAt).toBeNull()
    expect(by.apify_instagram!.coverageLabel).toBe('sampled')
    expect(by.apify_linkedin!.coverageLabel).toBe('sampled')
    expect(body.spendTodayUsd).toBeCloseTo(0.1)
    expect(body.oldestSuccessAgeMin).toBe(500)
  })

  it('prefers the mode recorded by the last run', async () => {
    await run('reddit', 5, 'ok', { detail: { mode: 'live' } })
    const body = await get()
    expect(body.sources.find((s) => s.key === 'reddit')!.mode).toBe('live')
  })

  it('portal uses the market-hours interval during market hours', async () => {
    const body = await get()
    const p = body.sources.find((s) => s.key === 'portal_chittorgarh')!
    expect(p.effectiveIntervalMin).toBe(p.marketHoursIntervalMin)
  })

  it('youtube quota comes from the latest run quota detail', async () => {
    expect((await get()).youtubeQuota).toMatchObject({ unitsUsedToday: null, limit: 10000 })
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(NOW)
    await run('youtube', 5, 'ok', {
      detail: { quota: { day, unitsUsedToday: 4321, limit: 10000 } },
    })
    expect((await get()).youtubeQuota.unitsUsedToday).toBe(4321)
  })

  it('503 when the database fails', async () => {
    const saved = holder.ctx
    holder.ctx = {
      db: { execute: () => Promise.reject(new Error('down')) },
      sql: () => Promise.reject(new Error('down')),
      now: NOW,
    }
    try {
      expect((await GET(new Request('http://x/api/sources'), {})).status).toBe(503)
    } finally {
      holder.ctx = saved
    }
  })
})

describe('PATCH /api/sources', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch({ baseVersion: 1, sources: { reddit: { interval_min: 7 } } })).status).toBe(
      401,
    )
  })

  it('creates config version N+1 and a config_change event', async () => {
    const before = await get()
    const res = await patch({
      baseVersion: before.configVersion,
      sources: { reddit: { interval_min: 7 } },
    })
    expect(res.status).toBe(200)
    const after: SourcesResponse = await res.json()
    expect(after.configVersion).toBe(before.configVersion + 1)
    expect(after.sources.find((s) => s.key === 'reddit')!.intervalMin).toBe(7)
    const ev =
      await sql`select detail, actor from event_log where kind = 'config_change' order by id desc limit 1`
    expect(ev[0]!.detail).toMatchObject({ version: after.configVersion })
    expect(ev[0]!.actor).toBe('operator')
  })

  it.each([
    ['interval 0', { reddit: { interval_min: 0 } }, 'sources.reddit.interval_min'],
    ['youtube 10', { youtube: { interval_min: 10 } }, 'sources.youtube.interval_min'],
    [
      'market hours on reddit',
      { reddit: { market_hours_interval_min: 5 } },
      'sources.reddit.market_hours_interval_min',
    ],
  ])('400 for %s with a field error', async (_n, sources, path) => {
    const v = (await get()).configVersion
    const res = await patch({ baseVersion: v, sources })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.issues.map((i: { path: string[] }) => i.path.join('.'))).toContain(path)
    expect((await get()).configVersion).toBe(v)
  })

  it('409 on a stale baseVersion', async () => {
    const v = (await get()).configVersion
    await patch({ baseVersion: v, sources: { reddit: { interval_min: 8 } } })
    const res = await patch({ baseVersion: v, sources: { reddit: { interval_min: 9 } } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Config changed since you opened it, reload' })
  })

  it('400 for malformed JSON', async () => {
    const res = await PATCH(
      new Request('http://x/api/sources', { method: 'PATCH', body: 'nope' }),
      {},
    )
    expect(res.status).toBe(400)
  })

  it('token round trip: credsSet true, never echoed, stored encrypted; null clears', async () => {
    const v = (await get()).configVersion
    const res = await patch({ baseVersion: v, x: { bearerToken: `  ${TOKEN}  `, x_tier: 'basic' } })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain('SECRETTOKEN')
    const after: SourcesResponse = JSON.parse(text)
    expect(after.x.credsSet).toBe(true)
    expect(after.x.tier).toBe('basic')
    expect(JSON.stringify(await get())).not.toContain('SECRETTOKEN')

    const row = await sql`select config from config_versions order by version desc limit 1`
    const blob = (row[0]!.config as { sources: { x_api: { creds_ref: Record<string, string> } } })
      .sources.x_api.creds_ref.X_BEARER_TOKEN!
    expect(blob.startsWith('enc:v1:')).toBe(true)
    expect(blob).not.toContain('SECRETTOKEN')
    const events = JSON.stringify(
      await sql`select detail from event_log where kind = 'config_change'`,
    )
    expect(events).not.toContain('SECRETTOKEN')

    expect((await get()).x.modeLabel).toBe('Official API')
    const cleared = await patch({ baseVersion: after.configVersion, x: { bearerToken: null } })
    expect(((await cleared.json()) as SourcesResponse).x.credsSet).toBe(false)
  })

  it('503 Credential storage unavailable without a valid key', async () => {
    vi.stubEnv('CONFIG_ENCRYPTION_KEY', '')
    const v = (await get()).configVersion
    const res = await patch({ baseVersion: v, x: { bearerToken: TOKEN } })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Credential storage unavailable' })
    expect((await get()).configVersion).toBe(v)
  })
})

describe('GET /api/sources/[key]/runs', () => {
  const call = (key: string) =>
    GET_RUNS(new Request(`http://x/api/sources/${key}/runs`), { params: Promise.resolve({ key }) })

  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await call('reddit')).status).toBe(401)
  })
  it('400 for an unknown key', async () => {
    expect((await call('bogus')).status).toBe(400)
  })
  it('returns at most 10 rows newest first', async () => {
    for (let i = 1; i <= 12; i++) await run('reddit', i * 10, 'ok', { items: i })
    await run('youtube', 1, 'ok')
    const rows = (await (await call('reddit')).json()) as { at: string; itemsNew: number }[]
    expect(rows).toHaveLength(10)
    expect(rows[0]!.itemsNew).toBe(1)
    const ats = rows.map((r) => Date.parse(r.at))
    expect([...ats].sort((a, b) => b - a)).toEqual(ats)
  })
})
