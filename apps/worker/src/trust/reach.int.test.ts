import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { TRUST_DEFAULTS } from './config'
import { lastFullRescoreAt, refreshReachScores, resetReachCache } from './reach'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_reach')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  resetReachCache()
})

const h = () => ({ db, sql })
const cfg = TRUST_DEFAULTS.reach
const NOW = new Date('2026-10-16T04:00:00Z')
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000)

let seq = 0
async function author(followers: number | null): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, followers, delete_after)
    values ('x', ${`u-${seq}`}, ${followers}, now() + interval '90 days')
    returning id`
  return r!.id
}

async function addPost(opts: {
  sourceKey: string
  lane: 'social' | 'media'
  reachRaw?: Record<string, number>
  authorId?: string | null
  publishedAt?: Date
}): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, author_id, lane, text, published_at, reach_raw)
    values (${opts.sourceKey}, ${`ext-${seq}`}, ${`https://example.com/${seq}`},
            ${opts.authorId ?? null}, ${opts.lane}, ${`post ${seq}`},
            ${(opts.publishedAt ?? hoursAgo(2)).toISOString()}::timestamptz,
            ${JSON.stringify(opts.reachRaw ?? {})}::jsonb)
    returning id`
  return r!.id
}

type Scored = { id: string; source_key: string; lane: string; reach_score: number | null }
const scores = () => sql<Scored[]>`select id, source_key, lane, reach_score from posts order by id`

async function seed(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {}
  ids.xBig = await addPost({ sourceKey: 'x_api', lane: 'social', reachRaw: { followers: 10_000 } })
  ids.xZero = await addPost({ sourceKey: 'x_api', lane: 'social', reachRaw: { followers: 0 } })
  ids.xAuthor = await addPost({
    sourceKey: 'x_api',
    lane: 'social',
    reachRaw: { likes: 3 },
    authorId: await author(10_000),
  })
  ids.xNone = await addPost({ sourceKey: 'x_api', lane: 'social', reachRaw: { likes: 3 } })
  ids.reddit = await addPost({ sourceKey: 'reddit', lane: 'social', reachRaw: { upvotes: 999 } })
  ids.news = await addPost({ sourceKey: 'news_rss', lane: 'media' })
  ids.xMedia = await addPost({ sourceKey: 'x_api', lane: 'media', reachRaw: { followers: 5 } })
  return ids
}

describe('refreshReachScores', () => {
  it('a full refresh scores every post in [floor, 1], media posts exactly 0.6', async () => {
    const ids = await seed()
    const out = await refreshReachScores(h(), NOW, cfg, { full: true })
    expect(out.updated).toBe(7)

    const rows = await scores()
    expect(rows.every((r) => r.reach_score !== null)).toBe(true)
    for (const r of rows) {
      expect(r.reach_score!).toBeGreaterThanOrEqual(0.05)
      expect(r.reach_score!).toBeLessThanOrEqual(1)
      if (r.lane === 'media') expect(r.reach_score).toBeCloseTo(0.6, 6)
    }
    const by = Object.fromEntries(rows.map((r) => [r.id, r.reach_score!]))
    // Fewer than 20 samples: default p95Log (x 5, reddit 3).
    expect(by[ids.xBig!]).toBeCloseTo(0.8, 3)
    expect(by[ids.xZero!]).toBeCloseTo(0.05, 6)
    expect(by[ids.xAuthor!]).toBeCloseTo(0.8, 3)
    expect(by[ids.xNone!]).toBeCloseTo(0.25, 6)
    expect(by[ids.reddit!]).toBeCloseTo(1, 6)
    expect(lastFullRescoreAt()?.toISOString()).toBe(NOW.toISOString())
  })

  it('an incremental refresh touches only newly inserted rows', async () => {
    await seed()
    await refreshReachScores(h(), NOW, cfg, { full: true })
    // Mark the existing rows so any rewrite would show.
    await sql`update posts set reach_score = 0.5`

    const fresh = await addPost({
      sourceKey: 'reddit',
      lane: 'social',
      reachRaw: { upvotes: 0 },
      publishedAt: hoursAgo(1),
    })
    const out = await refreshReachScores(h(), new Date(NOW.getTime() + 60_000), cfg, {
      full: false,
    })
    expect(out.updated).toBe(1)
    const rows = await scores()
    for (const r of rows) {
      if (r.id === fresh) expect(r.reach_score).toBeCloseTo(0.05, 6)
      else expect(r.reach_score).toBeCloseTo(0.5, 6)
    }
    // The cache from the full pass is kept.
    expect(lastFullRescoreAt()?.toISOString()).toBe(NOW.toISOString())
  })

  it('an incremental refresh without a cached p95 runs a full pass', async () => {
    await seed()
    const out = await refreshReachScores(h(), NOW, cfg, { full: false })
    expect(out.updated).toBe(7)
    expect(lastFullRescoreAt()?.toISOString()).toBe(NOW.toISOString())
  })

  it('a full refresh uses the computed percentile once a source has 20 samples', async () => {
    // 20 reddit posts with log10(1+upvotes) = 1..20 / 10 -> p95 = 1.905 (linear interpolation)
    for (let i = 1; i <= 20; i++) {
      await addPost({
        sourceKey: 'reddit',
        lane: 'social',
        reachRaw: { upvotes: 10 ** (i / 10) - 1 },
      })
    }
    const top = await addPost({ sourceKey: 'reddit', lane: 'social', reachRaw: { upvotes: 9 } })
    await refreshReachScores(h(), NOW, cfg, { full: true })
    const [r] = await sql<{ reach_score: number }[]>`
      select reach_score from posts where id = ${top}`
    // 21 samples now; the extra log value 1 sits low in the distribution.
    expect(r!.reach_score).toBeGreaterThan(1 / 3)
    expect(r!.reach_score).toBeLessThan(0.6)
  })

  it('a full refresh leaves posts older than the lookback alone but scores their NULLs', async () => {
    const old = await addPost({
      sourceKey: 'x_api',
      lane: 'social',
      reachRaw: { followers: 10_000 },
      publishedAt: hoursAgo(24 * 10),
    })
    const oldScored = await addPost({
      sourceKey: 'x_api',
      lane: 'social',
      reachRaw: { followers: 10_000 },
      publishedAt: hoursAgo(24 * 10),
    })
    await sql`update posts set reach_score = 0.33 where id = ${oldScored}`
    await refreshReachScores(h(), NOW, cfg, { full: true })
    const rows = Object.fromEntries((await scores()).map((r) => [r.id, r.reach_score]))
    expect(rows[old]).toBeCloseTo(0.8, 3)
    expect(rows[oldScored]).toBeCloseTo(0.33, 6)
  })
})
