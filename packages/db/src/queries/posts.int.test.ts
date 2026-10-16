import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import type { NormalizedAuthor, NormalizedPost, SourceKey } from '@jio/core'
import type { Db } from '../client'
import { authors, posts } from '../schema'
import { connectTestDb, testDatabaseUrl, truncateAll } from '../testing'
import { upsertPosts } from './posts'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

const NOW = new Date('2026-10-16T12:00:00Z')
const DAY = 86_400_000

function post(id: string, extra: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    sourceKey: 'x_api',
    externalId: id,
    url: `https://x.com/i/status/${id}`,
    author: null,
    text: `Jio IPO GMP ${id}`,
    publishedAt: new Date('2026-10-16T10:00:00Z'),
    reachRaw: { likes: 3 },
    rawJson: { id },
    ...extra,
  }
}

const xAuthor = (extra: Partial<NormalizedAuthor> = {}): NormalizedAuthor => ({
  platform: 'x',
  platformUserId: 'u1',
  handle: 'investor',
  displayName: 'Investor',
  followers: 100,
  ...extra,
})

describe('upsertPosts', () => {
  it('inserts new posts and is idempotent on rerun', async () => {
    const batch = [post('1'), post('2'), post('3')]
    const first = await upsertPosts(db, batch, { isFixture: false, now: NOW })
    expect(first).toMatchObject({ inserted: 3, duplicates: 0, rejected: 0 })
    expect(first.insertedIds).toHaveLength(3)

    const again = await upsertPosts(db, batch, { isFixture: false, now: NOW })
    expect(again).toEqual({ inserted: 0, duplicates: 3, rejected: 0, insertedIds: [] })
    expect(await db.select().from(posts)).toHaveLength(3)
  })

  it('counts a key repeated inside one batch once as a duplicate', async () => {
    const res = await upsertPosts(db, [post('1'), post('1'), post('2')], { isFixture: false })
    expect(res).toMatchObject({ inserted: 2, duplicates: 1, rejected: 0 })
  })

  it('stores fields, leaves triage columns empty and follows isFixture', async () => {
    const res = await upsertPosts(db, [post('1')], { isFixture: true, now: NOW })
    const [row] = await db.select().from(posts).where(eq(posts.id, res.insertedIds[0]!))
    expect(row).toMatchObject({
      sourceKey: 'x_api',
      externalId: '1',
      url: 'https://x.com/i/status/1',
      text: 'Jio IPO GMP 1',
      lane: 'social',
      lang: null,
      contentHash: null,
      matchedTerms: [],
      reachRaw: { likes: 3 },
      rawJson: { id: '1' },
      isFixture: true,
      authorId: null,
    })
    expect(row!.publishedAt).toEqual(new Date('2026-10-16T10:00:00Z'))
  })

  it('merges one X author seen through x_api and x_apify', async () => {
    await upsertPosts(
      db,
      [
        post('a', { sourceKey: 'x_api', author: xAuthor() }),
        post('b', { sourceKey: 'x_apify', author: xAuthor({ followers: 120 }) }),
      ],
      { isFixture: false, now: NOW },
    )
    await upsertPosts(db, [post('c', { sourceKey: 'x_apify', author: xAuthor() })], {
      isFixture: false,
      now: NOW,
    })
    const rows = await db.select().from(authors)
    expect(rows).toHaveLength(1)
    const linked = await db.select({ a: posts.authorId }).from(posts)
    expect(new Set(linked.map((r) => r.a))).toEqual(new Set([rows[0]!.id]))
  })

  it('keeps a media_outlet kind against a later other sighting and null followers', async () => {
    await upsertPosts(
      db,
      [post('1', { author: xAuthor({ kind: 'media_outlet', followers: 5000 }) })],
      { isFixture: false, now: NOW },
    )
    const later = new Date(NOW.getTime() + DAY)
    await upsertPosts(
      db,
      [post('2', { author: xAuthor({ kind: 'other', followers: undefined, handle: 'renamed' }) })],
      { isFixture: false, now: later },
    )
    const [a] = await db.select().from(authors)
    expect(a).toMatchObject({ kind: 'media_outlet', followers: 5000, handle: 'renamed' })
    expect(a!.firstSeenAt).toEqual(NOW)
    expect(a!.lastSeenAt).toEqual(later)
    expect(a!.deleteAfter).toEqual(new Date(later.getTime() + 90 * DAY))

    await upsertPosts(db, [post('3', { author: xAuthor({ kind: 'public_figure' }) })], {
      isFixture: false,
      now: NOW,
    })
    const [b] = await db.select().from(authors)
    expect(b!.kind).toBe('public_figure')
    // an older sighting never moves last_seen_at or delete_after backwards
    expect(b!.lastSeenAt).toEqual(later)
  })

  it('sets delete_after from authorRetentionDays', async () => {
    await upsertPosts(db, [post('1', { author: xAuthor() })], {
      isFixture: false,
      now: NOW,
      authorRetentionDays: 30,
    })
    const [a] = await db.select().from(authors)
    expect(a!.deleteAfter).toEqual(new Date(NOW.getTime() + 30 * DAY))
  })

  it('strips U+0000 from text, author names and rawJson strings', async () => {
    const res = await upsertPosts(
      db,
      [
        post('1', {
          text: 'Jio\u0000 IPO',
          author: xAuthor({ handle: 'in\u0000v', displayName: 'In\u0000vestor' }),
          rawJson: { body: 'a\u0000b', nested: ['c\u0000'], keep: 'back\\u0000slash' },
        }),
      ],
      { isFixture: false },
    )
    expect(res.inserted).toBe(1)
    const [row] = await db.select().from(posts)
    expect(row!.text).toBe('Jio IPO')
    expect(row!.rawJson).toEqual({ body: 'ab', nested: ['c'], keep: 'back\\u0000slash' })
    const [a] = await db.select().from(authors)
    expect(a).toMatchObject({ handle: 'inv', displayName: 'Investor' })
  })

  it('rejects invalid rows without throwing', async () => {
    const res = await upsertPosts(
      db,
      [
        post('1', { publishedAt: new Date('not a date') }),
        post(''),
        post('3', { sourceKey: 'myspace' as SourceKey }),
        post('4'),
      ],
      { isFixture: false },
    )
    expect(res).toMatchObject({ inserted: 1, duplicates: 0, rejected: 3 })
  })

  it('resolves lane from post.lane, then opts.lane, then the source default', async () => {
    await upsertPosts(
      db,
      [
        post('1', { sourceKey: 'web_search', lane: 'social' }),
        post('2', { sourceKey: 'news_rss' }),
        post('3', { sourceKey: 'youtube' }),
      ],
      { isFixture: false },
    )
    await upsertPosts(db, [post('4', { sourceKey: 'youtube' })], {
      isFixture: false,
      lane: 'media',
    })
    const rows = await db
      .select({ id: posts.externalId, lane: posts.lane })
      .from(posts)
      .orderBy(asc(posts.externalId))
    expect(rows).toEqual([
      { id: '1', lane: 'social' },
      { id: '2', lane: 'media' },
      { id: '3', lane: 'social' },
      { id: '4', lane: 'media' },
    ])
  })

  it('inserts 1,200 posts in one call', async () => {
    const batch = Array.from({ length: 1200 }, (_, i) =>
      post(String(i), { author: xAuthor({ platformUserId: `u${i % 300}` }) }),
    )
    const res = await upsertPosts(db, batch, { isFixture: true })
    expect(res.inserted).toBe(1200)
    expect(res.insertedIds).toHaveLength(1200)
    expect(await db.select({ id: authors.id }).from(authors)).toHaveLength(300)
  })

  it('runs no queries for an empty array', async () => {
    const noDb = new Proxy({} as Db, {
      get() {
        throw new Error('no query expected')
      },
    })
    expect(await upsertPosts(noDb, [], { isFixture: false })).toEqual({
      inserted: 0,
      duplicates: 0,
      rejected: 0,
      insertedIds: [],
    })
  })
})
