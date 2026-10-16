import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { TRUST_DEFAULTS } from './config'
import { detectNearDupCoordination } from './coordination'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_coordination')
  ;({ sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
})

const cfg = TRUST_DEFAULTS.coordination
const NOW = new Date('2026-10-16T04:00:00Z')
const minAgo = (n: number) => new Date(NOW.getTime() - n * 60_000)

let seq = 0
async function author(): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, delete_after)
    values ('x', ${`u-${seq}`}, now() + interval '90 days')
    returning id`
  return r!.id
}

async function addPost(opts: {
  cluster: string | null
  authorId: string | null
  publishedAt: Date
  lane?: 'social' | 'media'
}): Promise<string> {
  seq++
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, author_id, lane, text, published_at,
                       near_dup_cluster_id)
    values (${opts.lane === 'media' ? 'news_rss' : 'x_api'}, ${`ext-${seq}`},
            ${`https://example.com/${seq}`}, ${opts.authorId}, ${opts.lane ?? 'social'},
            ${`post ${seq}`}, ${opts.publishedAt.toISOString()}::timestamptz, ${opts.cluster})
    returning id`
  return r!.id
}

type Row = { id: string; coord_suspected: boolean; coord_detected_at: string | null }
const rows = () =>
  sql<Row[]>`select id, coord_suspected, coord_detected_at::text from posts order by id`

describe('detectNearDupCoordination', () => {
  it('flags only the qualifying cluster and is idempotent', async () => {
    const yes: string[] = []
    for (let i = 0; i < 5; i++) {
      yes.push(
        await addPost({
          cluster: 'nd_yes',
          authorId: await author(),
          publishedAt: minAgo(100 - i * 10),
        }),
      )
    }
    const no: string[] = []
    const four = [await author(), await author(), await author(), await author()]
    for (let i = 0; i < 8; i++) {
      no.push(
        await addPost({ cluster: 'nd_no', authorId: four[i % 4]!, publishedAt: minAgo(50 - i) }),
      )
    }
    // Five media outlets syndicating the same wire copy.
    for (let i = 0; i < 5; i++) {
      no.push(
        await addPost({
          cluster: 'nd_wire',
          authorId: await author(),
          publishedAt: minAgo(30 - i),
          lane: 'media',
        }),
      )
    }
    // Outside the 26h lookback.
    for (let i = 0; i < 5; i++) {
      no.push(
        await addPost({
          cluster: 'nd_old',
          authorId: await author(),
          publishedAt: minAgo(27 * 60 + i),
        }),
      )
    }
    no.push(await addPost({ cluster: null, authorId: await author(), publishedAt: minAgo(5) }))

    const first = await detectNearDupCoordination({ sql }, NOW, cfg)
    expect(first).toEqual({ flagged: 5 })

    const after = await rows()
    const flagged = after.filter((r) => r.coord_suspected).map((r) => r.id)
    expect(new Set(flagged)).toEqual(new Set(yes))
    for (const r of after.filter((x) => x.coord_suspected)) {
      expect(new Date(r.coord_detected_at!).getTime()).toBe(NOW.getTime())
    }
    expect(after.filter((r) => !r.coord_suspected).every((r) => r.coord_detected_at === null)).toBe(
      true,
    )

    const later = new Date(NOW.getTime() + 60_000)
    const second = await detectNearDupCoordination({ sql }, later, cfg)
    expect(second).toEqual({ flagged: 0 })
    const again = await rows()
    expect(again).toEqual(after)
  })

  it('never resets a flag when the cluster no longer qualifies', async () => {
    const id = await addPost({ cluster: 'nd_x', authorId: await author(), publishedAt: minAgo(10) })
    await sql`update posts set coord_suspected = true,
              coord_detected_at = ${minAgo(5).toISOString()}::timestamptz where id = ${id}`
    expect(await detectNearDupCoordination({ sql }, NOW, cfg)).toEqual({ flagged: 0 })
    const [r] = await rows()
    expect(r!.coord_suspected).toBe(true)
    expect(new Date(r!.coord_detected_at!).getTime()).toBe(minAgo(5).getTime())
  })
})
