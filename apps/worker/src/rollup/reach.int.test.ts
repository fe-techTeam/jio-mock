import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { resetReachCache } from '../trust/reach'
import { recomputeRange, recomputeReachColumns, runRollup } from './index'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_rollup_reach')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  await upsertSeedTopics(db)
  resetReachCache()
})

const h = () => ({ db, sql })
const NOW = new Date('2026-10-16T04:00:30Z')
const BUCKET = new Date('2026-10-16T03:30:00Z')
const RANGE = { from: BUCKET, to: new Date('2026-10-16T03:45:00Z') }

let seq = 0
async function topicId(slug: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from topics where slug = ${slug}`
  return r!.id
}

async function addPost(opts: {
  publishedAt?: Date
  lane?: 'social' | 'media'
  reach?: number | null
  sourceKey?: string
  reachRaw?: Record<string, number>
}): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, lane, text, lang, published_at, reach_score,
                       reach_raw, content_hash, matched_terms)
    values (${opts.sourceKey ?? 'x_api'}, ${`ext-${seq}`}, ${`https://x.com/s/${seq}`},
            ${opts.lane ?? 'social'}, ${`post ${seq}`}, 'en',
            ${(opts.publishedAt ?? new Date('2026-10-16T03:40:00Z')).toISOString()}::timestamptz,
            ${opts.reach ?? null}, ${JSON.stringify(opts.reachRaw ?? {})}::jsonb,
            ${`hash-${seq}`}, ${sql.array(['jio ipo'])}::text[])
    returning id`
  return r!.id
}

async function label(
  postId: string,
  opts: {
    slug?: string
    origin?: 'model' | 'correction' | 'gold'
    sentiment?: 'positive' | 'neutral' | 'negative'
    entities?: string[]
    createdAt?: Date
  },
): Promise<void> {
  await sql`
    insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence, model,
                                 created_at)
    values (${postId}, ${opts.origin ?? 'model'}, ${await topicId(opts.slug ?? 'gmp-grey-market')},
            ${opts.sentiment ?? 'neutral'}, ${sql.array(opts.entities ?? [])}::text[],
            'high', 'test', ${(opts.createdAt ?? new Date(NOW.getTime() - 60_000)).toISOString()}::timestamptz)`
}

type Row = {
  entity: string
  lane: string
  items: number
  pos: number
  neu: number
  neg: number
  reach_pos: number
  reach_neu: number
  reach_neg: number
  suspected_coordinated: number
}

async function rows(): Promise<Row[]> {
  return sql<Row[]>`
    select entity, lane, items, pos, neu, neg, reach_pos, reach_neu, reach_neg,
           suspected_coordinated
    from topic_stats_15m order by entity, lane`
}
const find = (rs: Row[], entity: string, lane: string) =>
  rs.find((r) => r.entity === entity && r.lane === lane)!

describe('reach-weighted rollups', () => {
  it('(a) sums reach_score per sentiment and leaves the counts unchanged', async () => {
    for (const [reach, sentiment] of [
      [0.8, 'positive'],
      [0.2, 'positive'],
      [0.5, 'negative'],
    ] as const) {
      await label(await addPost({ reach }), { sentiment })
    }
    await recomputeRange(h(), RANGE)
    const all = find(await rows(), 'all', 'all')
    expect(all).toMatchObject({ items: 3, pos: 2, neu: 0, neg: 1 })
    expect(all.reach_pos).toBeCloseTo(1.0, 5)
    expect(all.reach_neg).toBeCloseTo(0.5, 5)
    expect(all.reach_neu).toBe(0)
  })

  it('(b) social and media rows sum to the all row for counts and reach', async () => {
    const specs = [
      [0.9, 'positive', 'social'],
      [0.3, 'neutral', 'social'],
      [0.6, 'negative', 'media'],
      [0.6, 'positive', 'media'],
      [0.05, 'negative', 'social'],
    ] as const
    for (const [reach, sentiment, lane] of specs) {
      await label(await addPost({ reach, lane }), { sentiment })
    }
    await recomputeRange(h(), RANGE)
    const rs = await rows()
    const all = find(rs, 'all', 'all')
    const social = find(rs, 'all', 'social')
    const media = find(rs, 'all', 'media')
    for (const k of ['items', 'pos', 'neu', 'neg'] as const) {
      expect(social[k] + media[k]).toBe(all[k])
    }
    for (const k of ['reach_pos', 'reach_neu', 'reach_neg'] as const) {
      expect(social[k] + media[k]).toBeCloseTo(all[k], 5)
    }
    expect(all.reach_pos).toBeCloseTo(1.5, 5)
  })

  it('(c) entity rows follow the effective classification; the all entity counts a post once', async () => {
    const p = await addPost({ reach: 0.4 })
    await label(p, { sentiment: 'positive', entities: ['isha', 'jio'] })
    await label(p, {
      origin: 'correction',
      sentiment: 'negative',
      entities: ['mukesh', 'akash'],
      createdAt: NOW,
    })
    await recomputeRange(h(), RANGE)
    const rs = await rows()
    expect(new Set(rs.map((r) => r.entity))).toEqual(new Set(['all', 'mukesh', 'akash']))
    for (const r of rs) {
      expect(r).toMatchObject({ items: 1, neg: 1, pos: 0 })
      expect(r.reach_neg).toBeCloseTo(0.4, 5)
      expect(r.reach_pos).toBe(0)
    }
  })

  it('(d) a post with a NULL reach_score contributes the unknown score', async () => {
    await label(await addPost({ reach: null }), { sentiment: 'neutral' })
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all').reach_neu).toBeCloseTo(0.25, 5)

    await recomputeRange(h(), RANGE, { unknownScore: 0.1 })
    expect(find(await rows(), 'all', 'all').reach_neu).toBeCloseTo(0.1, 5)
  })

  it('runRollup scores posts first, so no row with items has zero reach', async () => {
    const specs: [string, 'social' | 'media', Record<string, number>][] = [
      ['x_api', 'social', { followers: 10_000 }],
      ['x_api', 'social', { followers: 0 }],
      ['reddit', 'social', { upvotes: 12 }],
      ['news_rss', 'media', {}],
      ['youtube', 'social', {}],
    ]
    for (const [i, [sourceKey, lane, reachRaw]] of specs.entries()) {
      const p = await addPost({
        sourceKey,
        lane,
        reachRaw,
        publishedAt: new Date(NOW.getTime() - (i + 1) * 3_600_000),
      })
      await label(p, { sentiment: (['positive', 'neutral', 'negative'] as const)[i % 3] })
    }
    await runRollup(h(), NOW, { mode: 'full7d' })
    const [nulls] = await sql<{ n: number }[]>`
      select count(*)::int as n from posts where reach_score is null`
    expect(nulls!.n).toBe(0)
    const [zero] = await sql<{ n: number }[]>`
      select count(*)::int as n from topic_stats_15m
      where items > 0 and reach_pos + reach_neu + reach_neg = 0`
    expect(zero!.n).toBe(0)
    const [media] = await sql<{ r: number }[]>`
      select sum(reach_pos + reach_neu + reach_neg)::float8 as r from topic_stats_15m
      where lane = 'media' and entity = 'all'`
    expect(media!.r).toBeCloseTo(0.6, 5)
  })

  it('recomputeReachColumns rewrites only the reach columns of rows in range', async () => {
    const p = await addPost({ reach: 0.7, publishedAt: new Date('2026-10-14T10:05:00Z') })
    await label(p, { sentiment: 'positive' })
    await recomputeRange(h(), {
      from: new Date('2026-10-14T10:00:00Z'),
      to: new Date('2026-10-14T10:15:00Z'),
    })
    await sql`update topic_stats_15m set suspected_coordinated = 3, items = 42`
    await sql`update posts set reach_score = 0.2`

    const out = await recomputeReachColumns(h(), {
      from: new Date(NOW.getTime() - 7 * 86_400_000),
      to: NOW,
    })
    expect(out.rows).toBe(2)
    const all = find(await rows(), 'all', 'all')
    expect(all.reach_pos).toBeCloseTo(0.2, 5)
    expect(all.items).toBe(42)
    expect(all.suspected_coordinated).toBe(3)
  })

  it('a recent rollup after a full rescore refreshes reach in older buckets', async () => {
    const p = await addPost({
      reachRaw: { followers: 10_000 },
      publishedAt: new Date('2026-10-14T10:05:00Z'),
    })
    await label(p, { sentiment: 'positive', createdAt: new Date('2026-10-14T10:06:00Z') })
    await runRollup(h(), NOW, { mode: 'full7d' })
    expect(find(await rows(), 'all', 'all').reach_pos).toBeCloseTo(0.8, 3)

    // Stale reach in a bucket a 'recent' run would not recompute.
    await sql`update topic_stats_15m set reach_pos = 9`
    resetReachCache() // next run is a full rescore
    await runRollup(h(), NOW, { mode: 'recent' })
    expect(find(await rows(), 'all', 'all').reach_pos).toBeCloseTo(0.8, 3)
  })
})
