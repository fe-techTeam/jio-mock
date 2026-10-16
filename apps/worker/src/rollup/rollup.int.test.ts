import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { refreshTopicStatus } from './active'
import { recomputeRange, runRollup } from './index'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_rollup')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
  await upsertSeedTopics(db)
})

const h = () => ({ db, sql })
const NOW = new Date('2026-10-16T04:00:30Z')
const min = (n: number) => n * 60_000

let seq = 0
async function topicId(slug: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`select id from topics where slug = ${slug}`
  return r!.id
}

async function addPost(opts: {
  publishedAt: Date
  lane?: 'social' | 'media'
  reach?: number | null
}): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, lane, text, lang, published_at, reach_score,
                       content_hash, matched_terms)
    values ('x_api', ${`ext-${seq}`}, ${`https://x.com/s/${seq}`}, ${opts.lane ?? 'social'},
            ${`post ${seq}`}, 'en', ${opts.publishedAt.toISOString()}::timestamptz, ${opts.reach ?? null}, ${`hash-${seq}`},
            ${sql.array(['jio ipo'])}::text[])
    returning id`
  return r!.id
}

async function label(
  postId: string,
  opts: {
    slug: string
    origin?: 'model' | 'correction' | 'gold'
    sentiment?: 'positive' | 'neutral' | 'negative'
    entities?: string[]
    confidence?: 'high' | 'low'
    createdAt: Date
  },
): Promise<void> {
  await sql`
    insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence, model,
                                 created_at)
    values (${postId}, ${opts.origin ?? 'model'}, ${await topicId(opts.slug)},
            ${opts.sentiment ?? 'neutral'}, ${sql.array(opts.entities ?? [])}::text[],
            ${opts.confidence ?? 'high'}, 'test', ${opts.createdAt.toISOString()}::timestamptz)`
}

type StatRow = {
  bucket_start: Date
  slug: string
  entity: string
  lane: string
  items: number
  pos: number
  neu: number
  neg: number
  low_conf: number
  reach_pos: number
}

async function stats(): Promise<StatRow[]> {
  const rows = await sql<(Omit<StatRow, 'bucket_start'> & { bucket_start: string })[]>`
    select s.bucket_start, t.slug, s.entity, s.lane, s.items, s.pos, s.neu, s.neg, s.low_conf,
           s.reach_pos
    from topic_stats_15m s join topics t on t.id = s.topic_id
    order by s.bucket_start, t.slug, s.entity, s.lane`
  return rows.map((r) => ({ ...r, bucket_start: new Date(r.bucket_start) }))
}

describe('recomputeRange and runRollup', () => {
  it('fans a post out to (all|each entity) x (all|its lane) with items 1', async () => {
    const p = await addPost({ publishedAt: new Date('2026-10-16T03:40:00Z'), reach: 2.5 })
    await label(p, {
      slug: 'gmp-grey-market',
      sentiment: 'positive',
      entities: ['isha', 'jio'],
      createdAt: new Date(NOW.getTime() - min(1)),
    })

    const out = await runRollup(h(), NOW, { mode: 'recent' })
    expect(out.mode).toBe('recent')

    const rows = await stats()
    expect(rows.map((r) => `${r.slug}|${r.entity}|${r.lane}`).sort()).toEqual(
      [
        'gmp-grey-market|all|all',
        'gmp-grey-market|all|social',
        'gmp-grey-market|isha|all',
        'gmp-grey-market|isha|social',
        'gmp-grey-market|jio|all',
        'gmp-grey-market|jio|social',
      ].sort(),
    )
    for (const r of rows) {
      expect(r.bucket_start.toISOString()).toBe('2026-10-16T03:30:00.000Z')
      expect(r).toMatchObject({ items: 1, pos: 1, neu: 0, neg: 0, low_conf: 0 })
      expect(r.reach_pos).toBeCloseTo(2.5)
    }
    expect(out.rows).toBe(6)
  })

  it('a correction moves the counts on the next recent run and deletes the old rows', async () => {
    const p = await addPost({ publishedAt: new Date('2026-10-16T03:20:00Z') })
    await label(p, { slug: 'gmp-grey-market', createdAt: new Date('2026-10-16T03:25:00Z') })
    await recomputeRange(h(), {
      from: new Date('2026-10-16T03:15:00Z'),
      to: new Date('2026-10-16T03:30:00Z'),
    })
    expect(new Set((await stats()).map((r) => r.slug))).toEqual(new Set(['gmp-grey-market']))

    // The post's bucket (03:15) is neither the current nor the previous bucket at NOW.
    await label(p, {
      slug: 'valuation-price-band',
      origin: 'correction',
      sentiment: 'negative',
      createdAt: new Date(NOW.getTime() - min(1)),
    })
    const out = await runRollup(h(), NOW, { mode: 'recent' })
    expect(out.buckets).toBe(3)

    const rows = await stats()
    expect(new Set(rows.map((r) => r.slug))).toEqual(new Set(['valuation-price-band']))
    const all = rows.find((r) => r.entity === 'all' && r.lane === 'all')!
    expect(all).toMatchObject({ items: 1, neg: 1, pos: 0 })
  })

  it('9 items in 24h leave a seed topic dormant, 10 make it active', async () => {
    for (let i = 0; i < 9; i++) {
      const p = await addPost({ publishedAt: new Date(NOW.getTime() - min(60 * (i + 1))) })
      await label(p, { slug: 'listing-expectations', createdAt: NOW })
    }
    await runRollup(h(), NOW, { mode: 'full7d' })
    const status = async () =>
      (
        await sql<
          { status: string }[]
        >`select status from topics where slug = 'listing-expectations'`
      )[0]!.status
    expect(await status()).toBe('dormant')

    const p = await addPost({ publishedAt: new Date(NOW.getTime() - min(30)) })
    await label(p, { slug: 'listing-expectations', createdAt: NOW })
    await runRollup(h(), NOW, { mode: 'recent' })
    expect(await status()).toBe('active')

    // Emerging and unclassified rows are never touched.
    const others = await sql<{ slug: string; status: string }[]>`
      select slug, status from topics where kind <> 'seed' order by slug`
    expect(others.every((o) => o.status === 'active')).toBe(true)
  })

  it('refreshTopicStatus leaves dismissed seed topics alone', async () => {
    await sql`update topics set status = 'dismissed' where slug = 'gmp-grey-market'`
    const out = await refreshTopicStatus(h(), NOW, 10)
    const [r] = await sql<{ status: string }[]>`
      select status from topics where slug = 'gmp-grey-market'`
    expect(r!.status).toBe('dismissed')
    expect(out.active + out.dormant).toBe(9)
  })

  it('full7d never deletes a 10-day-old rollup row', async () => {
    const old = new Date('2026-10-06T04:00:00Z')
    await sql`
      insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items)
      values (${old.toISOString()}::timestamptz, ${await topicId('gmp-grey-market')}, 'all', 'all', 4)`
    const out = await runRollup(h(), NOW, { mode: 'full7d' })
    expect(out.mode).toBe('full7d')
    expect(out.buckets).toBe(7 * 96 + 1)
    const rows = await stats()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.items).toBe(4)
  })

  it('a low-confidence unclassified post increments low_conf on the unclassified topic', async () => {
    const p = await addPost({ publishedAt: new Date('2026-10-16T03:50:00Z'), lane: 'media' })
    await label(p, { slug: 'unclassified', confidence: 'low', createdAt: NOW })
    await runRollup(h(), NOW)
    const rows = await stats()
    expect(rows.map((r) => `${r.slug}|${r.entity}|${r.lane}`).sort()).toEqual([
      'unclassified|all|all',
      'unclassified|all|media',
    ])
    for (const r of rows) expect(r).toMatchObject({ items: 1, low_conf: 1, neu: 1 })
  })

  it('all/all items per bucket equal the classified posts published in it', async () => {
    const t = (s: string) => new Date(`2026-10-16T${s}Z`)
    const specs: [string, string, 'social' | 'media'][] = [
      ['03:01:00', 'gmp-grey-market', 'social'],
      ['03:05:00', 'gmp-grey-market', 'media'],
      ['03:14:59', 'valuation-price-band', 'social'],
      ['03:15:00', 'valuation-price-band', 'social'],
      ['03:44:00', 'unclassified', 'media'],
    ]
    for (const [at, slug, lane] of specs) {
      const p = await addPost({ publishedAt: t(at), lane })
      await label(p, { slug, entities: ['jio'], createdAt: NOW })
    }
    await addPost({ publishedAt: t('03:02:00') }) // not classified: never counted
    await runRollup(h(), NOW, { mode: 'full7d' })
    const per = await sql<{ bucket_start: string; items: number }[]>`
      select bucket_start, sum(items)::int as items from topic_stats_15m
      where entity = 'all' and lane = 'all' group by bucket_start order by bucket_start`
    expect(per.map((r) => [new Date(r.bucket_start).toISOString(), r.items])).toEqual([
      ['2026-10-16T03:00:00.000Z', 3],
      ['2026-10-16T03:15:00.000Z', 1],
      ['2026-10-16T03:30:00.000Z', 1],
    ])
  })
})
