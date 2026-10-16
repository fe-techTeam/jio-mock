// Hardening check of the retention promise against the real database: 30 days for raw_json,
// 90 days for text and authors, rollups and market points kept, config overrides respected.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import { getLatestConfig, saveConfigVersion, upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { PIPELINE_SCHEDULES } from './jobs'
import { retentionWindows, runRetention } from './retention'

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_retention_hardening')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  await upsertSeedTopics(db)
})

const NOW = new Date('2026-10-16T21:30:00Z') // 03:00 IST
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()
const handle = () => ({ db, sql })

async function author(name: string, lastSeenDays: number) {
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, handle, last_seen_at, delete_after)
    values ('x', ${name}, ${name}, ${daysAgo(lastSeenDays)}::timestamptz,
            ${daysAgo(lastSeenDays - 90)}::timestamptz)
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

async function state() {
  const posts = await sql<{ ext: string; has_raw: boolean; has_text: boolean }[]>`
    select external_id as ext, raw_json is not null as has_raw, text is not null as has_text
    from posts order by external_id`
  const eff = await sql<{ n: number }[]>`
    select count(*)::int as n from effective_classifications e
    where not exists (select 1 from posts p where p.id = e.post_id)`
  const authors = await sql<{ handle: string }[]>`select handle from authors order by handle`
  return { posts, orphanEffective: eff[0]!.n, authors: authors.map((a) => a.handle) }
}

async function seedRollups() {
  const [t] = await sql<{ id: string }[]>`select id from topics limit 1`
  await sql`
    insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items)
    values (${daysAgo(200)}::timestamptz, ${t!.id}, 'all', 'all', 3)`
  await sql`
    insert into market_points (series, value, observed_at, source_key, source_url)
    values ('gmp_inr', 120, ${daysAgo(200)}::timestamptz, 'portal_chittorgarh', 'https://x')`
}

async function counts() {
  const [s] = await sql<{ n: number }[]>`select count(*)::int as n from topic_stats_15m`
  const [m] = await sql<{ n: number }[]>`select count(*)::int as n from market_points`
  return { rollups: s!.n, market: m!.n }
}

describe('retention hardening', () => {
  it('applies the 30/90-day defaults, keeps rollups and market points, and is idempotent', async () => {
    const old = await author('old-author', 91)
    const young = await author('young-author', 10)
    for (const d of [29, 31, 89]) await post(`p${d}`, d, young)
    await post('p91', 91, old)
    await seedRollups()

    await runRetention(handle(), NOW, retentionWindows((await getLatestConfig(db)).config))
    const after = await state()

    const byExt = Object.fromEntries(after.posts.map((p) => [p.ext, p]))
    expect(byExt['p29']).toMatchObject({ has_raw: true, has_text: true })
    expect(byExt['p31']!.has_raw).toBe(false)
    expect(byExt['p89']).toMatchObject({ has_raw: false, has_text: true })
    expect(byExt['p91']).toBeUndefined()
    expect(after.orphanEffective).toBe(0)
    const [cls] = await sql<
      { n: number }[]
    >`select count(*)::int as n from effective_classifications`
    expect(cls!.n).toBe(3)
    expect(after.authors).toEqual(['young-author'])
    expect(await counts()).toEqual({ rollups: 1, market: 1 })

    const second = await runRetention(handle(), NOW, retentionWindows(DEFAULT_CONFIG))
    expect(second).toEqual({
      rawJsonCleared: 0,
      classificationsDeleted: 0,
      postsDeleted: 0,
      authorsDeleted: 0,
    })
    expect(await state()).toEqual(after)
  })

  it('moves the cutoffs when a saved config version overrides the retention days', async () => {
    const a = await author('a', 10)
    for (const d of [5, 15, 25]) await post(`q${d}`, d, a)
    await seedRollups()

    const { config } = await getLatestConfig(db)
    await saveConfigVersion(
      db,
      { ...config, retention_days: { ...config.retention_days, raw_json: 10, post_text: 20 } },
      'test',
    )
    const windows = retentionWindows((await getLatestConfig(db)).config)
    expect(windows).toMatchObject({ rawJsonDays: 10, postDays: 20 })

    await runRetention(handle(), NOW, windows)
    const after = await state()
    const byExt = Object.fromEntries(after.posts.map((p) => [p.ext, p]))
    expect(byExt['q5']).toMatchObject({ has_raw: true, has_text: true })
    expect(byExt['q15']).toMatchObject({ has_raw: false, has_text: true })
    expect(byExt['q25']).toBeUndefined()
    expect(after.orphanEffective).toBe(0)
    expect(await counts()).toEqual({ rollups: 1, market: 1 })
  })

  it('schedules the retention queue once a day at 03:00 IST', () => {
    expect(PIPELINE_SCHEDULES.retention).toEqual({ cron: '0 3 * * *', tz: 'Asia/Kolkata' })
  })
})
