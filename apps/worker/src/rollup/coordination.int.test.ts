import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { resetReachCache } from '../trust/reach'
import { recomputeRange, runRollup } from './index'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_rollup_coord')
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
const SLUG = 'gmp-grey-market'
const BUCKET = new Date('2026-10-16T03:30:00Z')
const RANGE = { from: BUCKET, to: new Date(BUCKET.getTime() + 15 * 60_000) }
const IN_BUCKET = new Date('2026-10-16T03:40:00Z')
const minBefore = (d: Date, n: number) => new Date(d.getTime() - n * 60_000)

let seq = 0
async function topicId(slug = SLUG): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from topics where slug = ${slug}`
  return r!.id
}

const authorIds = new Map<string, string>()
async function author(name: string): Promise<string> {
  const known = authorIds.get(name)
  if (known) {
    const [r] = await sql<{ id: string }[]>`select id from authors where id = ${known}`
    if (r) return known
  }
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, handle, delete_after)
    values ('x', ${name}, ${name}, now() + interval '90 days')
    on conflict (platform, platform_user_id) do update set handle = excluded.handle
    returning id`
  authorIds.set(name, r!.id)
  return r!.id
}

async function addPost(opts: {
  publishedAt?: Date
  lane?: 'social' | 'media'
  author?: string | null
  coord?: boolean
  cluster?: string | null
  entities?: string[]
  labelledAt?: Date
}): Promise<string> {
  seq++
  const authorId = opts.author ? await author(opts.author) : null
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, author_id, lane, text, lang, published_at,
                       content_hash, matched_terms, coord_suspected, near_dup_cluster_id)
    values (${opts.lane === 'media' ? 'news_rss' : 'x_api'}, ${`ext-${seq}`},
            ${`https://x.com/s/${seq}`}, ${authorId}, ${opts.lane ?? 'social'}, ${`post ${seq}`},
            'en', ${(opts.publishedAt ?? IN_BUCKET).toISOString()}::timestamptz, ${`hash-${seq}`},
            ${sql.array(['jio ipo'])}::text[], ${opts.coord ?? false}, ${opts.cluster ?? null})
    returning id`
  const id = r!.id
  await sql`
    insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence, model,
                                 created_at)
    values (${id}, 'model', ${await topicId()}, 'neutral', ${sql.array(opts.entities ?? [])}::text[],
            'high', 'test',
            ${(opts.labelledAt ?? new Date('2026-10-16T03:59:00Z')).toISOString()}::timestamptz)`
  return id
}

type Row = {
  bucket_start: string
  entity: string
  lane: string
  items: number
  suspected_coordinated: number
  burst_flag: boolean
  top5_author_share: number | null
}
async function rows(bucket = BUCKET): Promise<Row[]> {
  return sql<Row[]>`
    select bucket_start::text, entity, lane, items, suspected_coordinated, burst_flag,
           top5_author_share
    from topic_stats_15m
    where bucket_start = ${bucket.toISOString()}::timestamptz
    order by entity, lane`
}
const find = (rs: Row[], entity: string, lane: string) =>
  rs.find((r) => r.entity === entity && r.lane === lane)

/** 96 trailing all/all rows for SLUG, `items` each, ending just before `bucket`. */
async function seedTrailing(bucket: Date, items: number): Promise<void> {
  await sql`
    insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items, neu)
    select ${bucket.toISOString()}::timestamptz - (g * interval '15 minutes'), ${await topicId()},
           'all', 'all', ${items}, ${items}
    from generate_series(1, 96) as g`
}

describe('coordination columns in rollups', () => {
  it('(a) suspected_coordinated counts flagged posts per slice; all equals social', async () => {
    for (let i = 0; i < 3; i++) await addPost({ author: `c${i}`, coord: true, entities: ['jio'] })
    await addPost({ author: 'plain' })
    await addPost({ lane: 'media', author: 'outlet1' })
    await addPost({ lane: 'media', author: 'outlet2' })
    await recomputeRange(h(), RANGE)
    const rs = await rows()
    expect(find(rs, 'all', 'all')).toMatchObject({ items: 6, suspected_coordinated: 3 })
    expect(find(rs, 'all', 'social')).toMatchObject({ items: 4, suspected_coordinated: 3 })
    expect(find(rs, 'all', 'media')).toMatchObject({ items: 2, suspected_coordinated: 0 })
    expect(find(rs, 'jio', 'all')).toMatchObject({ items: 3, suspected_coordinated: 3 })
    expect(find(rs, 'all', 'all')!.suspected_coordinated).toBe(
      find(rs, 'all', 'social')!.suspected_coordinated,
    )
  })

  it('(b) burst_flag is set above 4x the trailing median, not below it', async () => {
    await seedTrailing(BUCKET, 2)
    for (let i = 0; i < 15; i++) await addPost({ author: `b${i}` })
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all')).toMatchObject({ items: 15, burst_flag: true })
  })

  it('(b) 15 items after 96 buckets of 5 is not a burst', async () => {
    await seedTrailing(BUCKET, 5)
    for (let i = 0; i < 15; i++) await addPost({ author: `b${i}` })
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all')).toMatchObject({ items: 15, burst_flag: false })
  })

  it('(b) a recompute clears a burst that no longer holds', async () => {
    for (let i = 0; i < 15; i++) await addPost({ author: `b${i}` })
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all')!.burst_flag).toBe(true)
    await seedTrailing(BUCKET, 5)
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all')!.burst_flag).toBe(false)
  })

  it('(c) top5_author_share covers the trailing 24h window ending at the bucket end', async () => {
    const plan: [string, number][] = [
      ['a', 10],
      ['b', 5],
      ['c', 5],
      ['d', 5],
      ['e', 5],
      ['f', 1],
      ['g', 1],
    ]
    let k = 0
    for (const [name, n] of plan) {
      for (let i = 0; i < n; i++) {
        // Spread over the window [bucket_end - 24h, bucket_end): the oldest is 23h50m back.
        await addPost({ author: name, publishedAt: minBefore(IN_BUCKET, (k++ * 37) % (23 * 60)) })
      }
    }
    // Outside the window: older than 24h before the bucket end, or after it.
    await addPost({ author: 'a', publishedAt: minBefore(RANGE.to, 24 * 60 + 1) })
    await addPost({ author: 'z', publishedAt: new Date(RANGE.to.getTime() + 60_000) })
    await recomputeRange(h(), RANGE)
    const rs = await rows()
    expect(find(rs, 'all', 'all')!.top5_author_share).toBeCloseTo(0.94, 5)
    expect(find(rs, 'all', 'social')!.top5_author_share).toBeCloseTo(0.94, 5)
  })

  it('(c) null below 30 posts; null authors count in the total but not as authors', async () => {
    const plan: [string | null, number][] = [
      ['a', 10],
      ['b', 4],
      ['c', 4],
      ['d', 4],
      ['e', 4],
      ['f', 3],
    ]
    for (const [name, n] of plan) {
      for (let i = 0; i < n; i++)
        await addPost({ author: name, publishedAt: minBefore(IN_BUCKET, i * 20) })
    }
    await recomputeRange(h(), RANGE)
    expect(find(await rows(), 'all', 'all')!.top5_author_share).toBeNull()

    await addPost({ author: null })
    await recomputeRange(h(), RANGE)
    // 26 of 30: the null-author post counts in the total only.
    expect(find(await rows(), 'all', 'all')!.top5_author_share).toBeCloseTo(0.87, 5)
  })

  it('(d) a post flagged after its bucket was rolled up is counted within one run', async () => {
    const T1 = new Date('2026-10-16T04:00:30Z')
    const old = new Date('2026-10-16T03:20:00Z') // bucket 03:15
    const oldBucket = new Date('2026-10-16T03:15:00Z')
    for (let i = 0; i < 4; i++) {
      await addPost({
        author: `n${i}`,
        cluster: 'nd_1',
        publishedAt: new Date(old.getTime() + i * 60_000),
        labelledAt: minBefore(T1, 1),
      })
    }
    const first = await runRollup(h(), T1, { mode: 'recent' })
    expect(first.coordination.flagged).toBe(0)
    expect(find(await rows(oldBucket), 'all', 'all')).toMatchObject({
      items: 4,
      suspected_coordinated: 0,
    })

    // A fifth author joins the cluster 40 minutes later, in the current bucket.
    const T2 = new Date('2026-10-16T04:10:30Z')
    await addPost({
      author: 'n4',
      cluster: 'nd_1',
      publishedAt: new Date('2026-10-16T04:00:00Z'),
      labelledAt: minBefore(T2, 1),
    })
    const second = await runRollup(h(), T2, { mode: 'recent' })
    expect(second.coordination.flagged).toBe(5)
    expect(find(await rows(oldBucket), 'all', 'all')).toMatchObject({
      items: 4,
      suspected_coordinated: 4,
    })
    expect(find(await rows(oldBucket), 'all', 'social')!.suspected_coordinated).toBe(4)
    expect(find(await rows(new Date('2026-10-16T04:00:00Z')), 'all', 'all')).toMatchObject({
      items: 1,
      suspected_coordinated: 1,
    })
  })

  it('stores no author identifier in topic_stats_15m', async () => {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_name = 'topic_stats_15m' and (column_name like '%author_id%' or column_name like '%handle%')`
    expect(r!.n).toBe(0)
  })
})
