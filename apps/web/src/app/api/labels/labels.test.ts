// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'

const handle = vi.hoisted(() => ({ current: null as { db: unknown; sql: unknown } | null }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/db', () => ({ getDb: () => handle.current }))

import { auth } from '@/lib/auth'
import { NOW, many, minutesAgo, resetAndSeed, type PostSpec } from '@/lib/queries/test-fixtures'
import { POST } from './route'
import { DELETE } from './[id]/route'
import { GET as QUEUE } from './queue/route'

let db: Db
let sql: Sql
const getSession = vi.mocked(auth.api.getSession)
const SESSION = { user: { email: 'op@jio.local' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>
const TOPIC = 'valuation-price-band'
const OTHER = 'listing-expectations'

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_labels')
  ;({ db, sql } = connectTestDb(url))
  handle.current = { db, sql }
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(() => {
  getSession.mockReset().mockResolvedValue(SESSION)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const body = (o: Record<string, unknown>) => ({
  postId: '',
  origin: 'correction',
  sentiment: 'positive',
  topicSlug: TOPIC,
  entities: [],
  ...o,
})
const post = (o: Record<string, unknown>) =>
  POST(
    new Request('http://localhost:3100/api/labels', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body(o)),
    }),
    {},
  )
const del = (id: string) =>
  DELETE(new Request(`http://localhost:3100/api/labels/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })
const queue = (qs = '') => QUEUE(new Request(`http://localhost:3100/api/labels/queue${qs}`), {})

const modelPost = (o: Partial<PostSpec> = {}): PostSpec => ({
  publishedAt: minutesAgo(30),
  labels: [{ topic: TOPIC, sentiment: 'negative', glossEn: 'gloss here' }],
  ...o,
})

const effective = async (postId: string) =>
  (
    await sql<{ sentiment: string; origin: string; slug: string; entities: string[] }[]>`
      select e.sentiment, e.origin, t.slug, e.entities
      from effective_classifications e join topics t on t.id = e.topic_id
      where e.post_id = ${postId}`
  )[0]!
const events = async () =>
  sql<{ detail: Record<string, unknown>; actor: string }[]>`
    select detail, actor from event_log where kind = 'relabel' order by id`

describe('POST /api/labels', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await post({ postId: '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c' })).status).toBe(401)
  })

  it('a correction becomes the effective label, copies the gloss and logs one event', async () => {
    const { postIds } = await resetAndSeed(sql, { posts: [modelPost({ lang: 'hi' })] })
    const res = await post({
      postId: postIds[0],
      sentiment: 'positive',
      topicSlug: OTHER,
      entities: ['jio', 'isha'],
      sarcastic: true,
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; classificationId: string }
    expect(json.ok).toBe(true)
    expect(json.classificationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(await effective(postIds[0]!)).toMatchObject({
      origin: 'correction',
      sentiment: 'positive',
      slug: OTHER,
    })
    const [row] = await sql<
      {
        confidence: string
        gloss_en: string
        model: string | null
        prompt_version: string | null
        actor: string
      }[]
    >`select confidence, gloss_en, model, prompt_version, actor from classifications where id = ${json.classificationId}`
    expect(row).toEqual({
      confidence: 'high',
      gloss_en: 'gloss here',
      model: null,
      prompt_version: null,
      actor: 'op@jio.local',
    })
    const ev = await events()
    expect(ev).toHaveLength(1)
    expect(ev[0]!.actor).toBe('op@jio.local')
    expect(ev[0]!.detail).toMatchObject({
      postId: postIds[0],
      origin: 'correction',
      classificationId: json.classificationId,
      from: { sentiment: 'negative', topicSlug: TOPIC, entities: [] },
      to: { sentiment: 'positive', topicSlug: OTHER, entities: ['jio', 'isha'] },
      sarcastic: true,
    })
  })

  it('404 unknown post, 400 unknown or dismissed topic, 400 duplicate entities', async () => {
    const { postIds } = await resetAndSeed(sql, {
      posts: [modelPost()],
      topics: [{ slug: 'dead-topic', status: 'dismissed' }],
    })
    expect((await post({ postId: '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c' })).status).toBe(404)
    expect((await post({ postId: postIds[0], topicSlug: 'nope' })).status).toBe(400)
    expect((await post({ postId: postIds[0], topicSlug: 'dead-topic' })).status).toBe(400)
    expect((await post({ postId: postIds[0], entities: ['jio', 'jio'] })).status).toBe(400)
    expect(await events()).toHaveLength(0)
  })

  it('a gold row wins over an earlier correction', async () => {
    const { postIds } = await resetAndSeed(sql, { posts: [modelPost()] })
    await post({ postId: postIds[0], origin: 'correction', sentiment: 'positive' })
    await post({ postId: postIds[0], origin: 'gold', sentiment: 'neutral' })
    expect(await effective(postIds[0]!)).toMatchObject({ origin: 'gold', sentiment: 'neutral' })
  })

  it('409 for the 201st distinct gold post, but relabelling a gold post is allowed', async () => {
    const { postIds } = await resetAndSeed(sql, {
      rollup: false,
      posts: many(201, (i) =>
        modelPost({
          labels: [
            { topic: TOPIC },
            ...(i < 200 ? [{ topic: TOPIC, origin: 'gold' as const }] : []),
          ],
        }),
      ),
    })
    const blocked = await post({ postId: postIds[200], origin: 'gold' })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ error: 'Gold set complete' })
    expect((await post({ postId: postIds[0], origin: 'gold', sentiment: 'positive' })).status).toBe(
      200,
    )
    expect((await post({ postId: postIds[200], origin: 'correction' })).status).toBe(200)
  }, 60_000)
})

describe('DELETE /api/labels/[id]', () => {
  it('undo restores the previous effective label and logs one undo event', async () => {
    const { postIds } = await resetAndSeed(sql, { posts: [modelPost()] })
    const created = (await (await post({ postId: postIds[0], sentiment: 'positive' })).json()) as {
      classificationId: string
    }
    expect((await effective(postIds[0]!)).sentiment).toBe('positive')
    const res = await del(created.classificationId)
    expect(res.status).toBe(200)
    expect(await effective(postIds[0]!)).toMatchObject({ origin: 'model', sentiment: 'negative' })
    const ev = await events()
    expect(ev).toHaveLength(2)
    expect(ev[1]!.detail).toEqual({
      undo: true,
      classificationId: created.classificationId,
      postId: postIds[0],
    })
  })

  it('409 for a model row, 409 outside the window, 404 unknown, 400 bad id', async () => {
    const { postIds } = await resetAndSeed(sql, {
      posts: [
        modelPost({
          labels: [
            { topic: TOPIC },
            { topic: TOPIC, origin: 'correction', createdAt: new Date(NOW.getTime() - 3_600_000) },
          ],
        }),
      ],
    })
    const rows = await sql<{ id: string; origin: string; age_ms: number }[]>`
      select id, origin, extract(epoch from (now() - created_at)) * 1000 as age_ms
      from classifications where post_id = ${postIds[0]!}`
    const model = rows.find((r) => r.origin === 'model')!
    const old = rows.find((r) => r.origin === 'correction')!
    expect((await del(model.id)).status).toBe(409)
    expect((await del(old.id)).status).toBe(409)
    expect((await del('6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c')).status).toBe(404)
    expect((await del('nope')).status).toBe(400)
    expect(await events()).toHaveLength(0)
  })
})

describe('GET /api/labels/queue', () => {
  it('never returns fixtures, excluded ids, non-target languages or the model label', async () => {
    const { postIds } = await resetAndSeed(sql, {
      posts: [
        modelPost({ lang: 'en', text: 'fixture one' }),
        modelPost({ lang: 'en', text: 'live one' }),
        modelPost({ lang: 'en', text: 'live two' }),
        modelPost({ lang: 'other', text: 'other lang' }),
      ],
    })
    await sql`update posts set is_fixture = true where id = ${postIds[0]!}`
    const seen: string[] = []
    let exclude = ''
    for (let i = 0; i < 3; i++) {
      const res = await queue(exclude ? `?exclude=${exclude}` : '')
      const json = (await res.json()) as {
        item: Record<string, unknown> | null
        progress: { labelled: number; target: number }
      }
      if (!json.item) break
      seen.push(json.item.text as string)
      expect(Object.keys(json.item).sort()).toEqual(
        ['glossEn', 'lang', 'postId', 'publishedAt', 'sourceKey', 'text', 'url'].sort(),
      )
      exclude = [exclude, json.item.postId as string].filter(Boolean).join(',')
      expect(json.progress.target).toBe(200)
    }
    expect(seen.sort()).toEqual(['live one', 'live two'])
  })

  it('serves the language with the fewest gold labels (3 hi, 0 gu -> gu)', async () => {
    await resetAndSeed(sql, {
      rollup: false,
      posts: [
        ...many(3, () =>
          modelPost({
            lang: 'hi',
            labels: [{ topic: TOPIC }, { topic: TOPIC, origin: 'gold' }],
          }),
        ),
        modelPost({ lang: 'hi', text: 'hi candidate' }),
        modelPost({ lang: 'gu', text: 'gu candidate' }),
      ],
    })
    const json = (await (await queue()).json()) as {
      item: { lang: string; text: string }
      progress: { labelled: number; byLang: Record<string, number> }
    }
    expect(json.item).toMatchObject({ lang: 'gu', text: 'gu candidate' })
    expect(json.progress.labelled).toBe(3)
    expect(json.progress.byLang).toMatchObject({ hi: 3, gu: 0, en: 0, hinglish: 0 })
  })

  it('returns item null with progress when nothing is left, and carries no author fields', async () => {
    await resetAndSeed(sql, {
      authors: [{ key: 'a', kind: 'media_outlet', handle: 'livemint', displayName: 'Mint' }],
      posts: [modelPost({ author: 'a' })],
    })
    const first = await (await queue()).text()
    expect(first).not.toMatch(/livemint|author|raw-json-marker/)
    const id = (JSON.parse(first) as { item: { postId: string } }).item.postId
    const json = (await (await queue(`?exclude=${id}`)).json()) as { item: null; progress: unknown }
    expect(json.item).toBeNull()
    expect(json.progress).toMatchObject({ labelled: 0, target: 200 })
  })

  it('400 for a malformed exclude list and 401 without a session', async () => {
    expect((await queue('?exclude=abc')).status).toBe(400)
    getSession.mockResolvedValue(null)
    expect((await queue()).status).toBe(401)
  })
})
