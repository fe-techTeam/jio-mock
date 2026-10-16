import { createCipheriv, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import {
  DEFAULT_CONFIG,
  type FetchContext,
  type FetchResult,
  type Lane,
  type NormalizedPost,
  type SourceAdapter,
  type SourceKey,
} from '@jio/core'
import { saveConfigVersion, schema, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import { RateLimitedError } from './breaker'
import { createFakeFetch } from './adapters/_fixture'
import {
  decryptSecret,
  resolveCreds,
  resolveMode,
  resolvePostLane,
  runFetch,
  sanitizePosts,
} from './runner'

// No test in this file may reach the network.
vi.stubGlobal('fetch', createFakeFetch([]))

const KEY_B64 = randomBytes(32).toString('base64')

function encrypt(plain: string, keyB64 = KEY_B64): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return 'enc:v1:' + Buffer.concat([iv, tag, ct]).toString('base64url')
}

const adapterStub = (requiredCreds: string[], lane: Lane = 'social'): SourceAdapter => ({
  key: 'reddit',
  lane,
  requiredCreds,
  fetch: async () => ({ posts: [], costUsd: 0 }),
})

function post(id: string, over: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    sourceKey: 'reddit',
    externalId: id,
    url: `https://www.reddit.com/r/x/comments/${id}/`,
    author: { platform: 'reddit', platformUserId: `u-${id}`, kind: 'other' },
    text: `Jio IPO post ${id}`,
    publishedAt: new Date('2026-10-19T05:00:00Z'),
    reachRaw: { score: 1 },
    rawJson: { id },
    ...over,
  }
}

describe('resolveMode', () => {
  const keyed = adapterStub(['APIFY_TOKEN'])
  const keyless = adapterStub([], 'media')
  it('fixture forces fixture regardless of creds', () => {
    expect(resolveMode('fixture', keyed, { APIFY_TOKEN: 't' })).toEqual({
      mode: 'fixture',
      reason: 'sources_mode',
    })
  })
  it('live with creds is live', () => {
    expect(resolveMode('live', keyed, { APIFY_TOKEN: 't' })).toEqual({ mode: 'live' })
  })
  it('live without creds is unconfigured, naming what is missing', () => {
    expect(resolveMode('live', keyed, {})).toEqual({
      mode: 'unconfigured',
      missing: ['APIFY_TOKEN'],
    })
  })
  it('auto with creds is live', () => {
    expect(resolveMode('auto', keyed, { APIFY_TOKEN: 't' })).toEqual({ mode: 'live' })
  })
  it('auto without creds falls back to fixture', () => {
    expect(resolveMode('auto', keyed, { APIFY_TOKEN: '' })).toEqual({
      mode: 'fixture',
      reason: 'missing_creds',
      missing: ['APIFY_TOKEN'],
    })
  })
  it('auto resolves keyless sources (news_rss, portals) live', () => {
    expect(resolveMode('auto', keyless, {})).toEqual({ mode: 'live' })
  })
  it('lists every missing credential', () => {
    expect(resolveMode('live', adapterStub(['A', 'B']), { A: 'x' })).toEqual({
      mode: 'unconfigured',
      missing: ['B'],
    })
  })
})

describe('decryptSecret', () => {
  it('decrypts an enc:v1 blob made with node:crypto', () => {
    expect(decryptSecret(encrypt('s3cr3t-tøken'), KEY_B64)).toBe('s3cr3t-tøken')
  })
  it('rejects a blob encrypted with another key', () => {
    const other = randomBytes(32).toString('base64')
    expect(() => decryptSecret(encrypt('x', other), KEY_B64)).toThrow()
  })
  it('rejects a tampered blob', () => {
    const blob = encrypt('hello')
    const raw = Buffer.from(blob.slice(7), 'base64url')
    raw[raw.length - 1]! ^= 1
    expect(() => decryptSecret('enc:v1:' + raw.toString('base64url'), KEY_B64)).toThrow()
  })
  it('rejects a key that is not 32 bytes', () => {
    expect(() => decryptSecret(encrypt('x'), Buffer.alloc(16).toString('base64'))).toThrow()
  })
  it('rejects a value without the enc:v1 prefix', () => {
    expect(() => decryptSecret('plain', KEY_B64)).toThrow()
  })
})

describe('resolveCreds', () => {
  const adapter = adapterStub(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'])
  const source = (creds_ref: Record<string, string> | null) => ({
    ...DEFAULT_CONFIG.sources.reddit,
    creds_ref,
  })
  it('reads env when config has nothing', () => {
    expect(
      resolveCreds(adapter, source(null), { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec' }),
    ).toEqual({ REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec' })
  })
  it('prefers a decrypted config value over env', () => {
    const creds = resolveCreds(adapter, source({ REDDIT_CLIENT_ID: encrypt('from-config') }), {
      CONFIG_ENCRYPTION_KEY: KEY_B64,
      REDDIT_CLIENT_ID: 'from-env',
      REDDIT_CLIENT_SECRET: 'sec',
    })
    expect(creds).toEqual({ REDDIT_CLIENT_ID: 'from-config', REDDIT_CLIENT_SECRET: 'sec' })
  })
  it('treats an undecryptable config value as missing', () => {
    const creds = resolveCreds(adapter, source({ REDDIT_CLIENT_ID: 'enc:v1:garbage' }), {
      CONFIG_ENCRYPTION_KEY: KEY_B64,
      REDDIT_CLIENT_ID: 'from-env',
    })
    expect(creds.REDDIT_CLIENT_ID).toBeUndefined()
  })
  it('treats a config value as missing when CONFIG_ENCRYPTION_KEY is unset', () => {
    const creds = resolveCreds(adapter, source({ REDDIT_CLIENT_ID: encrypt('x') }), {})
    expect(creds.REDDIT_CLIENT_ID).toBeUndefined()
  })
  it('returns only the required names', () => {
    const creds = resolveCreds(adapter, source(null), { OTHER: 'x', REDDIT_CLIENT_ID: 'id' })
    expect(Object.keys(creds).sort()).toEqual(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'])
  })
})

describe('resolvePostLane', () => {
  const withKind = (kind?: 'media_outlet' | 'public_figure' | 'other') =>
    post('a', { author: { platform: 'x', platformUserId: '1', kind } })
  it('puts a media outlet in the media lane on a social source', () => {
    expect(resolvePostLane('social', withKind('media_outlet'))).toBe('media')
  })
  it('puts an ordinary author on a media source in the social lane', () => {
    expect(resolvePostLane('media', withKind('other'))).toBe('social')
  })
  it('puts a public figure on a media source in the social lane', () => {
    expect(resolvePostLane('media', withKind('public_figure'))).toBe('social')
  })
  it('keeps the adapter lane otherwise', () => {
    expect(resolvePostLane('social', withKind('public_figure'))).toBe('social')
    expect(resolvePostLane('media', post('b', { author: null }))).toBe('media')
    expect(resolvePostLane('media', withKind(undefined))).toBe('media')
  })
  it('honours a lane the adapter set on the post', () => {
    expect(resolvePostLane('media', { ...withKind('media_outlet'), lane: 'social' })).toBe('social')
  })
})

describe('sanitizePosts', () => {
  const now = new Date('2026-10-19T06:00:00Z')
  it('drops empty text and invalid dates', () => {
    const { valid, dropped } = sanitizePosts(
      [post('a'), post('b', { text: '   ' }), post('c', { publishedAt: new Date('nope') })],
      now,
    )
    expect(valid.map((p) => p.externalId)).toEqual(['a'])
    expect(dropped).toBe(2)
  })
  it('clamps dates more than 5 minutes in the future to now', () => {
    const { valid } = sanitizePosts(
      [
        post('a', { publishedAt: new Date(now.getTime() + 10 * 60_000) }),
        post('b', { publishedAt: new Date(now.getTime() + 4 * 60_000) }),
      ],
      now,
    )
    expect(valid[0]!.publishedAt).toEqual(now)
    expect(valid[1]!.publishedAt).toEqual(new Date(now.getTime() + 4 * 60_000))
  })
  it('caps text at 8,000 characters', () => {
    const { valid } = sanitizePosts([post('a', { text: 'x'.repeat(9000) })], now)
    expect(valid[0]!.text).toHaveLength(8000)
  })
  it('dedupes by externalId within the batch', () => {
    const { valid, dropped } = sanitizePosts([post('a'), post('a'), post('b')], now)
    expect(valid.map((p) => p.externalId)).toEqual(['a', 'b'])
    expect(dropped).toBe(1)
  })
})

// ------------------------------------------------------------------------------------------------
// Integration: runFetch against a dedicated test database.

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_runner')
  ;({ db, sql } = connectTestDb(url))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

type FetchImpl = (ctx: FetchContext) => Promise<FetchResult>

function fakeAdapter(
  key: SourceKey,
  impl: FetchImpl,
  opts: { lane?: Lane; requiredCreds?: string[] } = {},
): SourceAdapter & { calls: FetchContext[] } {
  const calls: FetchContext[] = []
  return {
    key,
    lane: opts.lane ?? 'social',
    requiredCreds: opts.requiredCreds ?? [],
    calls,
    async fetch(ctx) {
      calls.push(ctx)
      return impl(ctx)
    },
  }
}

const adaptersWith = (a: SourceAdapter) =>
  ({ [a.key]: a }) as unknown as Record<SourceKey, SourceAdapter>

async function fetchRuns(sourceKey: SourceKey) {
  return db
    .select()
    .from(schema.eventLog)
    .where(and(eq(schema.eventLog.kind, 'fetch_run'), eq(schema.eventLog.sourceKey, sourceKey)))
    .orderBy(asc(schema.eventLog.id))
}

const T0 = new Date('2026-10-19T06:00:00Z')
const clock = (d: Date) => () => new Date(d)

describe('runFetch', () => {
  beforeEach(async () => {
    await sql.unsafe(
      'truncate table posts, authors, event_log, market_points, config_versions restart identity cascade',
    )
  })

  const threePosts = () => [post('p1'), post('p2'), post('p3')]

  it('(a) stores fixture posts and logs one ok fetch_run', async () => {
    const adapter = fakeAdapter('reddit', async () => ({ posts: threePosts(), costUsd: 0.25 }))
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' }, now: clock(T0) },
      'reddit',
    )
    expect(out).toMatchObject({
      sourceKey: 'reddit',
      status: 'ok',
      mode: 'fixture',
      fetched: 3,
      inserted: 3,
      duplicates: 0,
      costUsd: 0.25,
    })
    const rows = await db.select().from(schema.posts)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.isFixture)).toBe(true)
    const runs = await fetchRuns('reddit')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'ok', itemsNew: 3, costUsd: 0.25 })
    expect(runs[0]!.durationMs).toBeGreaterThanOrEqual(0)
    expect(runs[0]!.detail).toMatchObject({
      mode: 'fixture',
      fetched: 3,
      duplicates: 0,
      dropped: 0,
    })
  })

  it('(b) a second run inserts nothing and counts duplicates', async () => {
    const adapter = fakeAdapter('reddit', async () => ({ posts: threePosts(), costUsd: 0 }))
    const deps = { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } }
    await runFetch(deps, 'reddit')
    const out = await runFetch(deps, 'reddit')
    expect(out).toMatchObject({ status: 'ok', inserted: 0, duplicates: 3 })
    expect((await fetchRuns('reddit'))[1]).toMatchObject({ itemsNew: 0 })
  })

  it('(c) passes the cursor on and overlaps since by 5 minutes; first run backfills 7 days', async () => {
    const adapter = fakeAdapter('reddit', async (ctx) => ({
      posts: [],
      costUsd: 0,
      nextCursor: ctx.cursor ? 'c2' : 'c1',
    }))
    const adapters = adaptersWith(adapter)
    const env = { SOURCES_MODE: 'fixture' }
    await runFetch({ db, adapters, env, now: clock(T0) }, 'reddit')
    expect(adapter.calls[0]!.cursor).toBeUndefined()
    expect(adapter.calls[0]!.since).toEqual(new Date(T0.getTime() - 7 * 86_400_000))

    const run1 = (await fetchRuns('reddit'))[0]!
    expect(run1.detail).toMatchObject({ cursor: 'c1', startedAt: T0.toISOString() })

    await runFetch({ db, adapters, env, now: clock(new Date(T0.getTime() + 600_000)) }, 'reddit')
    expect(adapter.calls[1]!.cursor).toBe('c1')
    expect(adapter.calls[1]!.since).toEqual(new Date(T0.getTime() - 5 * 60_000))
  })

  it('(c2) an error run keeps the previous cursor for the next run', async () => {
    let n = 0
    const adapter = fakeAdapter('reddit', async () => {
      n += 1
      if (n === 2) throw new Error('flaky')
      return { posts: [], costUsd: 0, nextCursor: `c${n}` }
    })
    const deps = { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } }
    await runFetch(deps, 'reddit')
    await runFetch(deps, 'reddit')
    await runFetch(deps, 'reddit')
    expect(adapter.calls.map((c) => c.cursor)).toEqual([undefined, 'c1', 'c1'])
    expect((await fetchRuns('reddit'))[1]!.detail).toMatchObject({ cursor: 'c1' })
  })

  it('(d) logs an adapter error and never rejects', async () => {
    const adapter = fakeAdapter('reddit', async () => {
      throw new Error('HTTP 500 from reddit')
    })
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'reddit',
    )
    expect(out).toMatchObject({ status: 'error', error: 'HTTP 500 from reddit', inserted: 0 })
    const runs = await fetchRuns('reddit')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'error', error: 'HTTP 500 from reddit', itemsNew: 0 })
  })

  it('(e) logs rate_limited with detail.rateLimitedUntil', async () => {
    const resetAt = new Date('2026-10-19T06:15:00Z')
    const adapter = fakeAdapter('youtube', async () => {
      throw new RateLimitedError('quota exhausted', resetAt)
    })
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'youtube',
    )
    expect(out.status).toBe('rate_limited')
    const [run] = await fetchRuns('youtube')
    expect(run).toMatchObject({ status: 'rate_limited', error: 'quota exhausted' })
    expect(run!.detail).toMatchObject({ rateLimitedUntil: resetAt.toISOString() })
  })

  it('(f) aborts an adapter at its timeout', async () => {
    const adapter = fakeAdapter(
      'reddit',
      (ctx) =>
        new Promise<FetchResult>((_, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted by signal')))
        }),
    )
    const out = await runFetch(
      {
        db,
        adapters: adaptersWith(adapter),
        env: { SOURCES_MODE: 'fixture' },
        timeoutsMs: { reddit: 50 },
      },
      'reddit',
    )
    expect(out).toMatchObject({ status: 'error', error: 'timeout after 50ms' })
    expect(adapter.calls[0]!.signal.aborted).toBe(true)
    expect((await fetchRuns('reddit'))[0]).toMatchObject({
      status: 'error',
      error: 'timeout after 50ms',
    })
  })

  it('(f2) times out an adapter that ignores its signal', async () => {
    const adapter = fakeAdapter('reddit', () => new Promise<FetchResult>(() => {}))
    const out = await runFetch(
      {
        db,
        adapters: adaptersWith(adapter),
        env: { SOURCES_MODE: 'fixture' },
        timeoutsMs: { reddit: 30 },
      },
      'reddit',
    )
    expect(out).toMatchObject({ status: 'error', error: 'timeout after 30ms' })
  })

  it('(g) inserts market points, suffixing fixture URLs with #fixture', async () => {
    const observedAt = new Date('2026-10-19T05:30:00Z')
    const adapter = fakeAdapter(
      'portal_chittorgarh',
      async () => ({
        posts: [],
        costUsd: 0,
        marketPoints: [
          {
            series: 'gmp_inr',
            value: 128,
            observedAt,
            sourceKey: 'portal_chittorgarh',
            sourceUrl: 'https://www.chittorgarh.com/report/ipo-gmp/',
          },
          {
            series: 'sub_total_x',
            value: 5.37,
            observedAt,
            sourceKey: 'portal_chittorgarh',
            sourceUrl: 'https://www.chittorgarh.com/report/ipo-subscription/',
          },
        ],
      }),
      { lane: 'media' },
    )
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'portal_chittorgarh',
    )
    expect(out).toMatchObject({ status: 'ok', marketPoints: 2 })
    const rows = await db
      .select()
      .from(schema.marketPoints)
      .orderBy(asc(schema.marketPoints.series))
    expect(rows.map((r) => r.sourceUrl)).toEqual([
      'https://www.chittorgarh.com/report/ipo-gmp/#fixture',
      'https://www.chittorgarh.com/report/ipo-subscription/#fixture',
    ])
    expect((await fetchRuns('portal_chittorgarh'))[0]!.detail).toMatchObject({ marketPoints: 2 })
  })

  it('(g2) keeps live market point URLs unchanged', async () => {
    const adapter = fakeAdapter(
      'portal_ipowatch',
      async () => ({
        posts: [],
        costUsd: 0,
        marketPoints: [
          {
            series: 'gmp_inr',
            value: 130,
            observedAt: new Date('2026-10-19T05:30:00Z'),
            sourceKey: 'portal_ipowatch',
            sourceUrl: 'https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/',
          },
        ],
      }),
      { lane: 'media' },
    )
    await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'live' } },
      'portal_ipowatch',
    )
    const [row] = await db.select().from(schema.marketPoints)
    expect(row!.sourceUrl).toBe('https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/')
  })

  it('(h) live mode with missing creds logs not configured and never calls fetch', async () => {
    const adapter = fakeAdapter('apify_instagram', async () => ({ posts: [], costUsd: 0 }), {
      requiredCreds: ['APIFY_TOKEN'],
    })
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'live' } },
      'apify_instagram',
    )
    expect(adapter.calls).toHaveLength(0)
    expect(out).toMatchObject({ status: 'error', error: 'not configured: missing APIFY_TOKEN' })
    expect((await fetchRuns('apify_instagram'))[0]).toMatchObject({
      status: 'error',
      error: 'not configured: missing APIFY_TOKEN',
    })
  })

  it('(h2) modeOverride live behaves the same without creds', async () => {
    const adapter = fakeAdapter('apify_instagram', async () => ({ posts: [], costUsd: 0 }), {
      requiredCreds: ['APIFY_TOKEN'],
    })
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'auto' } },
      'apify_instagram',
      { modeOverride: 'live' },
    )
    expect(adapter.calls).toHaveLength(0)
    expect(out.error).toBe('not configured: missing APIFY_TOKEN')
  })

  it('(i) copies a top-level quota from a JSON cursor into detail.quota', async () => {
    const adapter = fakeAdapter('youtube', async () => ({
      posts: [],
      costUsd: 0,
      nextCursor: JSON.stringify({ quota: { used: 1200, limit: 10000 }, page: 'p2' }),
    }))
    await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'youtube',
    )
    expect((await fetchRuns('youtube'))[0]!.detail).toMatchObject({
      quota: { used: 1200, limit: 10000 },
    })
  })

  it('passes resolved creds and live mode to the adapter', async () => {
    const adapter = fakeAdapter('x_api', async () => ({ posts: [], costUsd: 0 }), {
      requiredCreds: ['X_BEARER_TOKEN'],
    })
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'auto', X_BEARER_TOKEN: 'tok' } },
      'x_api',
    )
    expect(out.mode).toBe('live')
    expect(adapter.calls[0]).toMatchObject({ mode: 'live', creds: { X_BEARER_TOKEN: 'tok' } })
    expect(adapter.calls[0]!.source).toEqual(DEFAULT_CONFIG.sources.x_api)
    expect(adapter.calls[0]!.terms).toEqual(DEFAULT_CONFIG.terms)
  })

  it('redacts credential values from logged errors', async () => {
    const adapter = fakeAdapter(
      'x_api',
      async () => {
        throw new Error('GET https://api.x.com/2/search?token=tok-123 failed')
      },
      { requiredCreds: ['X_BEARER_TOKEN'] },
    )
    const out = await runFetch(
      {
        db,
        adapters: adaptersWith(adapter),
        env: { SOURCES_MODE: 'live', X_BEARER_TOKEN: 'tok-123' },
      },
      'x_api',
    )
    expect(out.error).not.toContain('tok-123')
    expect((await fetchRuns('x_api'))[0]!.error).not.toContain('tok-123')
  })

  it('a live run after fixture runs starts a fresh backfill', async () => {
    const adapter = fakeAdapter(
      'reddit',
      async () => ({ posts: [], costUsd: 0, nextCursor: 'fx' }),
      {
        requiredCreds: ['REDDIT_CLIENT_ID'],
      },
    )
    const adapters = adaptersWith(adapter)
    await runFetch({ db, adapters, env: { SOURCES_MODE: 'fixture' }, now: clock(T0) }, 'reddit')
    await runFetch(
      { db, adapters, env: { SOURCES_MODE: 'live', REDDIT_CLIENT_ID: 'id' }, now: clock(T0) },
      'reddit',
    )
    expect(adapter.calls[1]!.cursor).toBeUndefined()
    expect(adapter.calls[1]!.since).toEqual(new Date(T0.getTime() - 7 * 86_400_000))
  })

  it('stores per-post lanes (media outlet on a social source goes to media)', async () => {
    const adapter = fakeAdapter('x_api', async () => ({
      posts: [
        post('m1', {
          sourceKey: 'x_api',
          author: { platform: 'x', platformUserId: 'etm', kind: 'media_outlet' },
        }),
        post('s1', { sourceKey: 'x_api' }),
      ],
      costUsd: 0,
    }))
    await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'x_api',
    )
    const rows = await db.select().from(schema.posts).orderBy(asc(schema.posts.externalId))
    expect(rows.map((r) => [r.externalId, r.lane])).toEqual([
      ['m1', 'media'],
      ['s1', 'social'],
    ])
  })

  it('uses the latest saved config', async () => {
    const cfg = structuredClone(DEFAULT_CONFIG)
    cfg.sources.reddit.params = { subreddits: ['only_this'] }
    await saveConfigVersion(db, cfg, 'test')
    const adapter = fakeAdapter('reddit', async () => ({ posts: [], costUsd: 0 }))
    await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'reddit',
    )
    expect(adapter.calls[0]!.source.params).toEqual({ subreddits: ['only_this'] })
  })

  it('counts dropped posts', async () => {
    const adapter = fakeAdapter('reddit', async () => ({
      posts: [post('ok'), post('empty', { text: '' })],
      costUsd: 0,
    }))
    const out = await runFetch(
      { db, adapters: adaptersWith(adapter), env: { SOURCES_MODE: 'fixture' } },
      'reddit',
    )
    expect(out).toMatchObject({ fetched: 2, inserted: 1 })
    expect((await fetchRuns('reddit'))[0]!.detail).toMatchObject({ fetched: 2, dropped: 1 })
  })
})
