import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MARKET_SERIES, type SourceKey } from '@jio/core'
import { upsertPosts } from './queries/posts'
import { insertMarketPoints } from './queries/market'
import { upsertSeedTopics } from './queries/topics'
import {
  amplifyFixturePosts,
  demoSnapshot,
  resetDemoData,
  spreadFixtureTimestamps,
  synthesizeMarketHistory,
} from './seed-demo'
import { connectTestDb, testDatabaseUrl, truncateAll } from './testing'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))
const NOW = new Date('2026-10-16T08:00:00Z')
const H = 3_600_000

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
  await upsertSeedTopics(db)
})

const SOURCES: SourceKey[] = ['x_api', 'x_apify', 'reddit', 'youtube', 'news_rss', 'apify_linkedin']

async function seedFixtures(n = 40) {
  const posts = Array.from({ length: n }, (_, i) => {
    const source = SOURCES[i % SOURCES.length]!
    return {
      sourceKey: source,
      externalId: `fx-${String(i).padStart(3, '0')}`,
      url: `https://example.test/${i}`,
      text:
        i === 0
          ? 'Jio IPO ka price band bhai kya lagta hai, paisa lagana chahiye'
          : `Jio IPO opinion number ${i} about listing and valuation`,
      publishedAt: new Date(NOW.getTime() - 30 * 86_400_000),
      reachRaw: { likes: i },
      rawJson: null,
      author: {
        platform: 'x',
        platformUserId: `u${i}`,
        handle: `u${i}`,
        kind: 'other' as const,
      },
    }
  })
  await upsertPosts(db, posts, { isFixture: true, now: NOW })
  await insertMarketPoints(
    db,
    MARKET_SERIES.map((series, i) => ({
      series,
      value: 10 + i,
      observedAt: new Date('2026-10-15T10:00:00Z'),
      sourceKey: 'portal_chittorgarh' as const,
      sourceUrl: 'https://portal.test/jio#fixture',
    })),
  )
}

async function times(): Promise<{ id: string; at: Date; ext: string }[]> {
  const rows = await sql<{ id: string; at: string | Date; ext: string }[]>`
    select id, published_at as at, external_id as ext from posts where is_fixture order by external_id`
  return rows.map((r) => ({ ...r, at: new Date(r.at) }))
}

describe('resetDemoData', () => {
  it('leaves a non-fixture post and its classification untouched', async () => {
    await seedFixtures(3)
    await upsertPosts(
      db,
      [
        {
          sourceKey: 'reddit',
          externalId: 'live-1',
          url: 'https://example.test/live',
          text: 'Jio IPO live post',
          publishedAt: NOW,
          reachRaw: {},
          rawJson: null,
          author: null,
        },
      ],
      { isFixture: false, now: NOW },
    )
    const [live] = await sql<{ id: string }[]>`select id from posts where not is_fixture`
    const [topic] = await sql<{ id: string }[]>`select id from topics where slug = 'unclassified'`
    await sql`insert into classifications (post_id, origin, topic_id, sentiment, confidence)
      values (${live!.id}, 'model', ${topic!.id}, 'neutral', 'low')`

    const res = await resetDemoData(db, { now: NOW })
    expect(res.postsDeleted).toBe(3)
    expect(await sql`select 1 from posts where not is_fixture`).toHaveLength(1)
    expect(await sql`select 1 from classifications`).toHaveLength(1)
    expect(await sql`select 1 from posts where is_fixture`).toHaveLength(0)
  })

  it('keeps rollups older than 7 days, removes recent ones, and never touches event_log', async () => {
    const [topic] = await sql<{ id: string }[]>`select id from topics where slug = 'unclassified'`
    const old = new Date(NOW.getTime() - 10 * 86_400_000)
    const recent = new Date(NOW.getTime() - 2 * 86_400_000)
    for (const b of [old, recent]) {
      await sql`insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items)
        values (${b.toISOString()}::timestamptz, ${topic!.id}, 'all', 'all', 4)`
    }
    await sql`insert into event_log (kind) values ('fetch_run')`
    await resetDemoData(db, { now: NOW })
    const rows = await sql<{ b: string }[]>`select bucket_start as b from topic_stats_15m`
    expect(rows).toHaveLength(1)
    expect(new Date(rows[0]!.b).getTime()).toBe(old.getTime())
    expect(await sql`select 1 from event_log`).toHaveLength(1)
  })

  it('removes demo market points and unpromoted empty emerging topics only', async () => {
    await seedFixtures(1)
    await synthesizeMarketHistory(db, { now: NOW, seed: 1 })
    await sql`insert into topics (slug, name, kind) values ('em-a', 'A', 'emerging')`
    await sql`insert into topics (slug, name, kind, promoted_at) values ('em-b', 'B', 'emerging', now())`
    await resetDemoData(db, { now: NOW })
    expect(await sql`select 1 from market_points where source_url like '%#demo'`).toHaveLength(0)
    expect(await sql`select 1 from market_points where source_url like '%#fixture'`).toHaveLength(
      MARKET_SERIES.length,
    )
    const slugs = (await sql<{ slug: string }[]>`select slug from topics`).map((t) => t.slug)
    expect(slugs).not.toContain('em-a')
    expect(slugs).toContain('em-b')
  })
})

describe('amplifyFixturePosts', () => {
  it('creates variants with synthetic authors plus one coordinated cluster of 6', async () => {
    await seedFixtures(12)
    await amplifyFixturePosts(db, { seed: 42, copies: 3, now: NOW })
    const total = await sql<{ n: number }[]>`select count(*)::int as n from posts where is_fixture`
    expect(total[0]!.n).toBe(12 * 3 + 6)
    const coord = await sql<{ a: string }[]>`
      select author_id as a from posts where raw_json->>'demo' = 'coordinated'`
    expect(coord).toHaveLength(6)
    expect(new Set(coord.map((r) => r.a)).size).toBe(6)
    const variantAuthors = await sql`select 1 from authors where platform_user_id like 'demo-%'`
    expect(variantAuthors.length).toBeGreaterThanOrEqual(30)
  })

  it('is idempotent', async () => {
    await seedFixtures(6)
    await amplifyFixturePosts(db, { seed: 42, now: NOW })
    await amplifyFixturePosts(db, { seed: 42, now: NOW })
    const total = await sql<{ n: number }[]>`select count(*)::int as n from posts`
    expect(total[0]!.n).toBe(6 * 3 + 6)
  })
})

describe('spreadFixtureTimestamps', () => {
  async function prepared() {
    await seedFixtures(40)
    await amplifyFixturePosts(db, { seed: 42, now: NOW })
    await spreadFixtureTimestamps(db, { now: NOW, seed: 42 })
  }

  it('gives identical timestamps for the same seed and now', async () => {
    await prepared()
    const a = (await times()).map((r) => `${r.ext}@${r.at.toISOString()}`)
    await spreadFixtureTimestamps(db, { now: NOW, seed: 42 })
    const b = (await times()).map((r) => `${r.ext}@${r.at.toISOString()}`)
    expect(b).toEqual(a)
  })

  it('puts 40-50% of posts in the last 24h and none in the future', async () => {
    await prepared()
    const rows = await times()
    const last24 = rows.filter((r) => r.at.getTime() > NOW.getTime() - 24 * H).length
    expect(last24 / rows.length).toBeGreaterThanOrEqual(0.4)
    expect(last24 / rows.length).toBeLessThanOrEqual(0.5)
    expect(rows.every((r) => r.at.getTime() <= NOW.getTime() - 60_000)).toBe(true)
    expect(rows.every((r) => r.at.getTime() >= NOW.getTime() - 7 * 24 * H)).toBe(true)
    const bad = await sql<{ n: number }[]>`
      select count(*)::int as n from posts where fetched_at <> published_at + interval '2 minutes'`
    expect(bad[0]!.n).toBe(0)
  })

  it('keeps the coordinated cluster inside 30 minutes and the last 24h', async () => {
    await prepared()
    const rows = await sql<{ at: string }[]>`
      select published_at as at from posts where raw_json->>'demo' = 'coordinated'`
    expect(rows).toHaveLength(6)
    const ts = rows.map((r) => new Date(r.at).getTime())
    expect(Math.max(...ts) - Math.min(...ts)).toBeLessThanOrEqual(30 * 60_000)
    expect(Math.min(...ts)).toBeGreaterThan(NOW.getTime() - 24 * H)
  })

  it('never lets another near-copy group reach 5 authors within 60 minutes', async () => {
    await prepared()
    const raw = await sql<{ text: string; a: string; at: string; demo: string | null }[]>`
      select text, author_id as a, published_at as at, raw_json->>'demo' as demo
      from posts where is_fixture and lane = 'social'`
    const rows = raw.map((r) => ({ text: r.text, a: r.a, demo: r.demo, at: new Date(r.at) }))
    const coordText = rows.find((r) => r.demo === 'coordinated')!.text
    const groups = new Map<string, typeof rows>()
    for (const r of rows) {
      if (r.text === coordText) continue
      groups.set(r.text, [...(groups.get(r.text) ?? []), r])
    }
    for (const g of groups.values()) {
      g.sort((x, y) => x.at.getTime() - y.at.getTime())
      for (let i = 0; i < g.length; i++) {
        const win = g.filter(
          (r) => r.at.getTime() >= g[i]!.at.getTime() && r.at.getTime() - g[i]!.at.getTime() <= H,
        )
        expect(new Set(win.map((r) => r.a)).size).toBeLessThan(5)
      }
    }
  })

  it('keeps variants of one original at least 3h apart', async () => {
    await prepared()
    const rows = await times()
    const groups = new Map<string, number[]>()
    for (const r of rows) {
      if (r.ext.includes('~c')) continue
      const base = r.ext.split('~')[0]!
      groups.set(base, [...(groups.get(base) ?? []), r.at.getTime()])
    }
    for (const ts of groups.values()) {
      ts.sort((a, b) => a - b)
      for (let i = 1; i < ts.length; i++) expect(ts[i]! - ts[i - 1]!).toBeGreaterThanOrEqual(3 * H)
    }
  })
})

describe('synthesizeMarketHistory', () => {
  it('gives every series 7 days of hourly points ending at the fixture value', async () => {
    await seedFixtures(1)
    await synthesizeMarketHistory(db, { now: NOW, seed: 7 })
    for (const [i, series] of MARKET_SERIES.entries()) {
      const raw = await sql<{ v: number; at: string }[]>`
        select value as v, observed_at as at from market_points
        where series = ${series} order by observed_at`
      const rows = raw.map((r) => ({ v: r.v, at: new Date(r.at) }))
      expect(rows.length).toBeGreaterThanOrEqual(168)
      expect(rows[rows.length - 1]!.v).toBe(10 + i)
      if (series.startsWith('sub_')) {
        const last72 = rows.filter((r) => r.at.getTime() >= NOW.getTime() - 72 * H)
        for (let k = 1; k < last72.length; k++) {
          expect(last72[k]!.v).toBeGreaterThanOrEqual(last72[k - 1]!.v)
        }
        const before = rows.filter((r) => r.at.getTime() < NOW.getTime() - 73 * H)
        expect(before.every((r) => r.v === 0)).toBe(true)
      } else {
        expect(rows.every((r) => r.v >= 0)).toBe(true)
      }
    }
  })

  it('is repeatable', async () => {
    await seedFixtures(1)
    await synthesizeMarketHistory(db, { now: NOW, seed: 7 })
    const a = await sql`select count(*)::int as n from market_points`
    await synthesizeMarketHistory(db, { now: NOW, seed: 7 })
    const b = await sql`select count(*)::int as n from market_points`
    expect(b).toEqual(a)
  })
})

describe('demoSnapshot', () => {
  it('counts posts per source, market points and coordination', async () => {
    await seedFixtures(12)
    await synthesizeMarketHistory(db, { now: NOW, seed: 7 })
    const snap = await demoSnapshot(db, { now: NOW })
    expect(snap.posts).toBe(12)
    expect(snap.bySource.x_api).toBe(2)
    expect(snap.unclassified).toBe(12)
    expect(snap.classified).toBe(0)
    expect(snap.marketPoints.gmp_inr).toBeGreaterThanOrEqual(168)
    expect(snap.suspectedCoordinated).toBe(0)
    expect(snap.topics24h).toEqual([])
  })
})
