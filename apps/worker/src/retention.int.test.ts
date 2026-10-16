import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import { upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { retentionWindows, runRetention } from './retention'

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_retention')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  await upsertSeedTopics(db)
})

const handle = () => ({ db, sql })
const NOW = new Date('2026-10-16T21:30:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

async function author(handle: string, lastSeenDays: number, deleteAfterDays = 90) {
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, handle, last_seen_at, delete_after)
    values ('x', ${handle}, ${handle}, ${daysAgo(lastSeenDays)}::timestamptz,
            ${daysAgo(lastSeenDays - deleteAfterDays)}::timestamptz)
    returning id`
  return r!.id
}

async function post(ext: string, ageDays: number, authorId: string | null) {
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, author_id, lane, text, published_at,
                       fetched_at, raw_json)
    values ('x_api', ${ext}, ${`https://x.com/s/${ext}`}, ${authorId}, 'social', ${`text ${ext}`},
            ${daysAgo(ageDays)}::timestamptz, ${daysAgo(ageDays)}::timestamptz,
            ${JSON.stringify({ id: ext })}::jsonb)
    returning id`
  await sql`
    insert into classifications (post_id, origin, topic_id, sentiment, confidence)
    select ${r!.id}, 'model', id, 'neutral', 'high' from topics where slug = 'gmp-grey-market'`
  return r!.id
}

describe('retentionWindows', () => {
  it('reads the AppConfig retention keys', () => {
    expect(retentionWindows(DEFAULT_CONFIG)).toEqual({
      rawJsonDays: 30,
      postDays: 90,
      authorDays: 90,
    })
    expect(
      retentionWindows({
        ...DEFAULT_CONFIG,
        retention_days: { raw_json: 7, post_text: 60, authors: 45 },
      }),
    ).toEqual({ rawJsonDays: 7, postDays: 60, authorDays: 45 })
  })
})

describe('runRetention', () => {
  it('clears raw_json at 30d, deletes 90d posts, their labels and orphan authors only', async () => {
    const fresh = await author('fresh', 10)
    const mid = await author('mid', 40)
    const gone = await author('gone', 100)
    const orphanRecent = await author('orphan-recent', 5)
    await post('p10', 10, fresh)
    await post('p40', 40, mid)
    await post('p100', 100, gone)

    const topic = (await sql<{ id: string }[]>`select id from topics limit 1`)[0]!.id
    await sql`
      insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items)
      values (${daysAgo(120)}::timestamptz, ${topic}, 'all', 'all', 3)`
    await sql`
      insert into market_points (series, value, observed_at, source_key, source_url)
      values ('gmp_inr', 120, ${daysAgo(120)}::timestamptz, 'portal_chittorgarh', 'https://x')`
    await sql`insert into event_log (kind, at) values ('fetch_run', ${daysAgo(120)}::timestamptz)`

    const out = await runRetention(handle(), NOW, retentionWindows(DEFAULT_CONFIG))
    expect(out).toEqual({
      rawJsonCleared: 2,
      classificationsDeleted: 1,
      postsDeleted: 1,
      authorsDeleted: 1,
    })

    const posts = await sql<{ external_id: string; has_raw: boolean }[]>`
      select external_id, raw_json is not null as has_raw from posts order by external_id`
    expect(posts).toEqual([
      { external_id: 'p10', has_raw: true },
      { external_id: 'p40', has_raw: false },
    ])
    const [cls] = await sql<{ n: number }[]>`select count(*)::int as n from classifications`
    expect(cls!.n).toBe(2)

    const authors = await sql<{ handle: string }[]>`select handle from authors order by handle`
    expect(authors.map((a) => a.handle)).toEqual(['fresh', 'mid', 'orphan-recent'])
    expect(orphanRecent).toBeTruthy()

    const [stats] = await sql<{ n: number }[]>`select count(*)::int as n from topic_stats_15m`
    expect(stats!.n).toBe(1)
    const [mp] = await sql<{ n: number }[]>`select count(*)::int as n from market_points`
    expect(mp!.n).toBe(1)
    const [ev] = await sql<{ n: number }[]>`select count(*)::int as n from event_log`
    expect(ev!.n).toBe(1)
    const [tp] = await sql<{ n: number }[]>`select count(*)::int as n from topics`
    expect(tp!.n).toBe(12)

    // Idempotent.
    expect(await runRetention(handle(), NOW, retentionWindows(DEFAULT_CONFIG))).toEqual({
      rawJsonCleared: 0,
      classificationsDeleted: 0,
      postsDeleted: 0,
      authorsDeleted: 0,
    })
  })

  it('deletes an orphan author whose delete_after has passed even if seen recently', async () => {
    await author('expired', 5, 1) // delete_after = 4 days ago
    const out = await runRetention(handle(), NOW, retentionWindows(DEFAULT_CONFIG))
    expect(out.authorsDeleted).toBe(1)
  })
})
