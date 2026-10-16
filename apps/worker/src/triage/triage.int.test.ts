import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type NormalizedPost } from '@jio/core'
import { upsertPosts, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { HashingEmbedder } from '../classify/embed-stub'
import type { Embedder } from '../classify/embedder'
import { triagePosts } from './index'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_triage')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
})

const t0 = new Date('2026-10-20T05:00:00Z')
const terms = structuredClone(DEFAULT_CONFIG.terms)

function post(id: string, text: string, minutes = 0): NormalizedPost {
  return {
    sourceKey: 'x_api',
    externalId: id,
    url: `https://x.com/u/status/${id}`,
    author: { platform: 'x', platformUserId: `u-${id}`, handle: `u${id}`, kind: 'other' },
    text,
    publishedAt: new Date(t0.getTime() + minutes * 60_000),
    reachRaw: {},
    rawJson: { id },
  }
}

const GMP = 'Jio IPO GMP kitna chal raha hai bhai? listing gain milega?'

type Row = {
  external_id: string
  lang: string | null
  content_hash: string | null
  matched_terms: string[]
  has_embedding: boolean
  near_dup_cluster_id: string | null
}

async function rows(): Promise<Map<string, Row>> {
  const r = await sql<Row[]>`
    select external_id, lang, content_hash, matched_terms, embedding is not null as has_embedding,
           near_dup_cluster_id
    from posts`
  return new Map(r.map((x) => [x.external_id, x]))
}

describe('triagePosts', () => {
  it('triages, embeds, clusters and drops noise; a second run scans nothing', async () => {
    await upsertPosts(
      db,
      [
        post('1', `${GMP} https://t.co/aaa111`, 0),
        post('2', `${GMP} https://t.co/bbb222`, 7),
        post('3', 'जियो आईपीओ का जीएमपी आज कितना है? लिस्टिंग कब होगी', 3),
        post('4', 'jio aur jeene do', 4),
        post('5', 'JioHotstar new season streaming now, watch on JioHotstar', 5),
      ],
      { isFixture: true },
    )

    const stats = await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    expect(stats).toMatchObject({ scanned: 5, relevant: 3, dropped: 2, embedded: 3, clustered: 2 })
    expect(stats.embedCostUsd).toBe(0)

    const r = await rows()
    const [a, b, hi, noise1, noise2] = ['1', '2', '3', '4', '5'].map((k) => r.get(k)!)
    expect(a!.lang).toBe('hinglish')
    expect(a!.near_dup_cluster_id).not.toBeNull()
    expect(b!.near_dup_cluster_id).toBe(a!.near_dup_cluster_id)
    expect(a!.content_hash).toBe(b!.content_hash)
    expect(a!.matched_terms.length).toBeGreaterThan(0)

    expect(hi!.lang).toBe('hi')
    expect(hi!.has_embedding).toBe(true)
    expect(hi!.near_dup_cluster_id).toBeNull()

    for (const n of [noise1!, noise2!]) {
      expect(n.matched_terms).toEqual([])
      expect(n.has_embedding).toBe(false)
      expect(n.lang).not.toBeNull()
      expect(n.content_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(n.near_dup_cluster_id).toBeNull()
    }

    const again = await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    expect(again.scanned).toBe(0)
  })

  it('a later copy joins an existing cluster found in the database', async () => {
    await upsertPosts(db, [post('1', GMP, 0), post('2', `RT @trader: ${GMP}`, 5)], {
      isFixture: true,
    })
    await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    const first = (await rows()).get('1')!.near_dup_cluster_id
    expect(first).not.toBeNull()

    await upsertPosts(db, [post('3', `${GMP} https://t.co/zzz`, 60)], { isFixture: true })
    const stats = await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    expect(stats).toMatchObject({ scanned: 1, clustered: 1 })
    expect((await rows()).get('3')!.near_dup_cluster_id).toBe(first)
  })

  it('an unclustered database neighbor seeds a cluster shared with the new copy', async () => {
    await upsertPosts(db, [post('1', GMP, 0)], { isFixture: true })
    await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    expect((await rows()).get('1')!.near_dup_cluster_id).toBeNull()

    await upsertPosts(db, [post('2', GMP, 30)], { isFixture: true })
    await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    const r = await rows()
    expect(r.get('1')!.near_dup_cluster_id).toMatch(/^nd_/)
    expect(r.get('2')!.near_dup_cluster_id).toBe(r.get('1')!.near_dup_cluster_id)
  })

  it('copies more than 48h apart are not clustered', async () => {
    await upsertPosts(db, [post('1', GMP, 0)], { isFixture: true })
    await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    await upsertPosts(db, [post('2', GMP, 49 * 60)], { isFixture: true })
    await triagePosts({ db, sql }, { embedder: new HashingEmbedder(), terms })
    const r = await rows()
    expect(r.get('2')!.near_dup_cluster_id).toBeNull()
  })

  it('an embedder failure still records lang, hash and terms, with no embedding', async () => {
    await upsertPosts(db, [post('1', GMP, 0), post('2', 'jio aur jeene do', 1)], {
      isFixture: true,
    })
    const failing: Embedder = {
      model: 'broken',
      dims: 1024,
      embed: async () => {
        throw new Error('embed down')
      },
    }
    const log = vi.fn()
    const stats = await triagePosts({ db, sql }, { embedder: failing, terms, log })
    expect(stats).toMatchObject({ scanned: 2, relevant: 1, dropped: 1, embedded: 0, clustered: 0 })
    expect(log).toHaveBeenCalled()
    const r = await rows()
    expect(r.get('1')).toMatchObject({ lang: 'hinglish', has_embedding: false })
    expect(r.get('1')!.matched_terms.length).toBeGreaterThan(0)
    expect(r.get('1')!.content_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('stores an all-zero vector as NULL and honours limit', async () => {
    await upsertPosts(db, [post('1', '#JioIPO', 0), post('2', GMP, 1), post('3', GMP, 2)], {
      isFixture: true,
    })
    const zero: Embedder = {
      model: 'zero',
      dims: 1024,
      embed: async (texts) => ({ vectors: texts.map(() => new Array(1024).fill(0)), costUsd: 0.5 }),
    }
    const stats = await triagePosts({ db, sql }, { embedder: zero, terms, limit: 2 })
    expect(stats).toMatchObject({ scanned: 2, relevant: 2, embedded: 0, embedCostUsd: 0.5 })
    const left = await sql`select count(*)::int as n from posts where lang is null`
    expect(left[0]!.n).toBe(1)
    const embedded = await sql`select count(*)::int as n from posts where embedding is not null`
    expect(embedded[0]!.n).toBe(0)
  })
})
