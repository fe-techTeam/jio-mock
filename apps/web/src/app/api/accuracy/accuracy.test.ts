// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'

const handle = vi.hoisted(() => ({ current: null as { db: unknown; sql: unknown } | null }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/db', () => ({ getDb: () => handle.current }))

import { auth } from '@/lib/auth'
import { many, minutesAgo, resetAndSeed, type PostSpec } from '@/lib/queries/test-fixtures'
import { GET } from './route'
import type { AccuracyResponse } from './_lib/compute'

let sql: Sql
const getSession = vi.mocked(auth.api.getSession)
const SESSION = { user: { email: 'op@jio.local' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const call = (qs = '') => GET(new Request(`http://localhost:3100/api/accuracy${qs}`), {})
const TOPIC = 'valuation-price-band'
const langs = ['en', 'hinglish', 'hi', 'gu'] as const

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_accuracy')
  const h = connectTestDb(url)
  sql = h.sql
  handle.current = h
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(() => {
  getSession.mockReset().mockResolvedValue(SESSION)
})

const post = (i: number, goldSentiment: 'positive' | 'negative' = 'positive'): PostSpec => ({
  publishedAt: minutesAgo(30),
  lang: langs[i % 4],
  labels: [
    { topic: TOPIC, sentiment: 'positive' },
    { topic: TOPIC, origin: 'gold', sentiment: goldSentiment },
  ],
})

describe('GET /api/accuracy', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('400 for a malformed promptVersion', async () => {
    expect((await call('?promptVersion=a b;drop')).status).toBe(400)
    expect((await call(`?promptVersion=${'x'.repeat(101)}`)).status).toBe(400)
  })

  it('199 gold posts: not measured, all figures null', async () => {
    await resetAndSeed(sql, { rollup: false, posts: many(199, (i) => post(i)) })
    const json = (await (await call()).json()) as AccuracyResponse
    expect(json).toMatchObject({ labelled: 199, measured: false, overall: null, confusion: null })
  }, 60_000)

  it('200 gold posts: measured, per language, sarcasm from the gold event, corrections', async () => {
    const { postIds } = await resetAndSeed(sql, {
      rollup: false,
      posts: many(200, (i) => post(i, i < 40 ? 'negative' : 'positive')),
    })
    await sql`update classifications set prompt_version = 'v1', model = 'm' where origin = 'model'`
    await sql`insert into event_log (kind, actor, detail) values
      ('relabel', 'op', ${JSON.stringify({
        postId: postIds[0],
        origin: 'gold',
        classificationId: 'x',
        sarcastic: true,
      })}::jsonb)`
    await sql`insert into classifications (post_id, origin, topic_id, sentiment, confidence)
      select ${postIds[0]!}, 'correction', id, 'neutral', 'high' from topics where slug = ${TOPIC}`
    const json = (await (await call('?promptVersion=latest')).json()) as AccuracyResponse
    expect(json).toMatchObject({
      labelled: 200,
      measured: true,
      unscored: 0,
      promptVersion: 'v1',
      corrections: { count: 1, usedAsFewShot: 1 },
      sarcasm: { n: 1, sentiment: 0 },
    })
    expect(json.overall).toEqual({ sentiment: 0.8, topic: 1, entitiesExact: 1 })
    expect(json.byLang.en!.n).toBe(50)
    expect(json.confusion).toEqual([
      [0, 0, 40],
      [0, 0, 0],
      [0, 0, 160],
    ])
    const older = (await (await call('?promptVersion=v0')).json()) as AccuracyResponse
    expect(older.unscored).toBe(200)
    expect(older.overall).toBeNull()
  }, 60_000)
})
