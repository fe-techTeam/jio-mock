import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql as dsql } from 'drizzle-orm'
import { classifications, effectiveClassifications, posts, topics } from './schema'
import { connectTestDb, prepareTestDb, testDatabaseUrl, truncateAll } from './testing'

const url = testDatabaseUrl('jio_ipo_test')
const { db, sql } = connectTestDb(url)

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

const APP_TABLES = [
  'authors',
  'posts',
  'topics',
  'classifications',
  'topic_stats_15m',
  'market_points',
  'config_versions',
  'event_log',
]
const AUTH_TABLES = ['user', 'session', 'account', 'verification']

function vec(n: number): string {
  return `[${Array.from({ length: n }, (_, i) => ((i % 7) / 7).toFixed(3)).join(',')}]`
}

let seq = 0
async function insertPost(extra: Partial<typeof posts.$inferInsert> = {}) {
  seq += 1
  const [row] = await db
    .insert(posts)
    .values({
      sourceKey: 'x_api',
      externalId: `ext-${seq}`,
      url: `https://x.com/i/${seq}`,
      lane: 'social',
      text: 'Jio IPO GMP looks strong',
      publishedAt: new Date('2026-10-16T10:00:00Z'),
      ...extra,
    })
    .returning({ id: posts.id })
  return row!.id
}

async function insertTopic(slug = 'gmp-grey-market') {
  const [row] = await db
    .insert(topics)
    .values({ slug, name: slug, kind: 'seed', description: 'd' })
    .returning({ id: topics.id })
  return row!.id
}

describe('testing helpers', () => {
  it('testDatabaseUrl swaps the database name and rejects unsafe names', () => {
    expect(new URL(testDatabaseUrl('jio_ipo_test_x')).pathname).toBe('/jio_ipo_test_x')
    expect(() => testDatabaseUrl('bad-name; drop')).toThrow(/Invalid test database name/)
  })

  it('prepareTestDb is idempotent and returns the url', async () => {
    expect(await prepareTestDb()).toBe(url)
  })
})

describe('migrations', () => {
  it('enables the vector and pgcrypto extensions', async () => {
    const rows = await sql<{ extname: string }[]>`select extname from pg_extension`
    const names = rows.map((r) => r.extname)
    expect(names).toContain('vector')
    expect(names).toContain('pgcrypto')
  })

  it('creates all 12 tables and the effective_classifications view', async () => {
    const rows = await sql<{ table_name: string; table_type: string }[]>`
      select table_name, table_type from information_schema.tables where table_schema = 'public'`
    const tables = rows.filter((r) => r.table_type === 'BASE TABLE').map((r) => r.table_name)
    for (const t of [...APP_TABLES, ...AUTH_TABLES]) expect(tables).toContain(t)
    expect(tables).toHaveLength(12)
    const views = rows.filter((r) => r.table_type === 'VIEW').map((r) => r.table_name)
    expect(views).toEqual(['effective_classifications'])
  })

  it('accepts a 1024-dimension embedding and rejects 1023', async () => {
    const id = await insertPost()
    await sql`update posts set embedding = ${vec(1024)}::vector where id = ${id}`
    await expect(
      sql`update posts set embedding = ${vec(1023)}::vector where id = ${id}`,
    ).rejects.toThrow(/dimensions/)
    const [row] = await db.select({ e: posts.embedding }).from(posts).where(eq(posts.id, id))
    expect(row!.e).toHaveLength(1024)
  })

  it('rejects a duplicate (source_key, external_id)', async () => {
    await insertPost({ externalId: 'dup' })
    const err = await insertPost({ externalId: 'dup' }).catch((e: unknown) => e)
    expect((err as { cause?: { code?: string } }).cause?.code).toBe('23505')
  })

  it('cascades classifications when a post is deleted', async () => {
    const postId = await insertPost()
    const topicId = await insertTopic()
    await db.insert(classifications).values({
      postId,
      origin: 'model',
      topicId,
      sentiment: 'positive',
      confidence: 'high',
    })
    await db.delete(posts).where(eq(posts.id, postId))
    const left = await db.select().from(classifications)
    expect(left).toHaveLength(0)
  })

  it('keeps an empty, untriaged post with defaults', async () => {
    const id = await insertPost()
    const [row] = await db.select().from(posts).where(eq(posts.id, id))
    expect(row!.lang).toBeNull()
    expect(row!.isFixture).toBe(false)
    expect(row!.matchedTerms).toEqual([])
    expect(row!.reachRaw).toEqual({})
    expect(row!.fetchedAt).toBeInstanceOf(Date)
  })
})

describe('effective_classifications view', () => {
  async function label(
    postId: string,
    topicId: string,
    origin: 'model' | 'correction' | 'gold',
    at: string,
    sentiment: 'positive' | 'neutral' | 'negative',
  ) {
    await db.insert(classifications).values({
      postId,
      topicId,
      origin,
      sentiment,
      confidence: 'high',
      createdAt: new Date(at),
    })
  }

  it('prefers the latest correction or gold row over newer model rows', async () => {
    const postId = await insertPost()
    const topicId = await insertTopic()
    await label(postId, topicId, 'model', '2026-10-16T01:00:00Z', 'positive')
    await label(postId, topicId, 'correction', '2026-10-16T02:00:00Z', 'negative')
    await label(postId, topicId, 'model', '2026-10-16T03:00:00Z', 'neutral')

    const read = () =>
      db.select().from(effectiveClassifications).where(eq(effectiveClassifications.postId, postId))
    let rows = await read()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.origin).toBe('correction')
    expect(rows[0]!.sentiment).toBe('negative')

    await label(postId, topicId, 'gold', '2026-10-16T04:00:00Z', 'positive')
    rows = await read()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.origin).toBe('gold')
    expect(rows[0]!.sentiment).toBe('positive')
  })

  it('returns the latest model row when there is no human label, one row per post', async () => {
    const a = await insertPost()
    const b = await insertPost()
    await insertPost() // never classified
    const topicId = await insertTopic()
    await label(a, topicId, 'model', '2026-10-16T01:00:00Z', 'positive')
    await label(a, topicId, 'model', '2026-10-16T02:00:00Z', 'negative')
    await label(b, topicId, 'model', '2026-10-16T01:00:00Z', 'neutral')

    const rows = await db.select().from(effectiveClassifications)
    expect(rows).toHaveLength(2)
    const byPost = new Map(rows.map((r) => [r.postId, r]))
    expect(byPost.get(a)!.sentiment).toBe('negative')
    expect(byPost.get(b)!.sentiment).toBe('neutral')
    const [count] = await db.execute<{ n: number }>(
      dsql`select count(distinct post_id)::int as n from classifications`,
    )
    expect(count!.n).toBe(rows.length)
  })
})
