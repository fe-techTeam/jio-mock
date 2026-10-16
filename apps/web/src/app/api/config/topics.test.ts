// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'

const h = vi.hoisted(() => ({ sql: null as unknown }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/db', () => ({ getDb: () => ({ db: {}, sql: h.sql }) }))

import { auth } from '@/lib/auth'
import { many, minutesAgo, resetAndSeed } from '@/lib/queries/test-fixtures'
import { POST } from '../topics/[slug]/promote/route'
import { GET as GET_AUDIT } from './audit/route'
import { GET, PATCH } from './topics/route'

const getSession = vi.mocked(auth.api.getSession)
const SESSION = { user: { email: 'op@jio.local' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>

let sql: Sql
beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_settings_topics')
  ;({ sql } = connectTestDb(url))
  h.sql = sql
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(() => {
  getSession.mockReset().mockResolvedValue(SESSION)
})

const emerging = { slug: 'nri-quota', name: 'NRI quota', kind: 'emerging' as const }
const promote = (slug: string, body: unknown) =>
  POST(
    new Request(`http://x/api/topics/${slug}/promote`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    {
      params: Promise.resolve({ slug }),
    },
  )
const events = (kind: string) => sql`select detail, actor from event_log where kind = ${kind}`
const listTopics = async () => (await GET(new Request('http://x/api/config/topics'), {})).json()

describe('GET /api/config/topics', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET(new Request('http://x'), {})).status).toBe(401)
  })

  it('lists seed topics with 24h counts, emerging with 3 author-free samples, unclassified', async () => {
    await resetAndSeed(sql, {
      topics: [emerging, { slug: 'old-news', name: 'Old', kind: 'emerging', status: 'dismissed' }],
      authors: [{ key: 'a', handle: 'secret_handle', kind: 'other' }],
      posts: [
        ...many(4, (i) => ({
          publishedAt: minutesAgo(10 + i),
          author: 'a',
          text: 'x'.repeat(300),
          labels: [{ topic: 'nri-quota', glossEn: 'gloss ' + i }],
        })),
        ...many(2, () => ({ publishedAt: minutesAgo(30), labels: [{ topic: 'gmp-grey-market' }] })),
        { publishedAt: minutesAgo(30 * 60), labels: [{ topic: 'gmp-grey-market' }] },
        { publishedAt: minutesAgo(20), labels: [{ topic: 'unclassified' }] },
        { publishedAt: minutesAgo(25), labels: [{ topic: 'old-news' }] },
      ],
    })
    const body = await listTopics()
    const gmp = body.seed.find((t: { slug: string }) => t.slug === 'gmp-grey-market')
    expect(gmp.items24h).toBe(2)
    expect(body.seed.every((t: { slug: string }) => t.slug !== 'nri-quota')).toBe(true)
    expect(body.emerging).toHaveLength(1)
    expect(body.emerging[0]).toMatchObject({ slug: 'nri-quota', items24h: 4 })
    expect(body.emerging[0].samples).toHaveLength(3)
    expect(body.emerging[0].samples[0].text).toHaveLength(200)
    expect(body.unclassified.count24h).toBe(1)
    expect(JSON.stringify(body)).not.toContain('secret_handle')
    expect(JSON.stringify(body)).not.toContain('author')
  })

  it('dismiss hides the topic from GET', async () => {
    await resetAndSeed(sql, { topics: [emerging] })
    expect((await promote('nri-quota', { action: 'dismiss' })).status).toBe(200)
    expect((await listTopics()).emerging).toEqual([])
    expect(await events('promote_topic')).toHaveLength(1)
  })
})

describe('PATCH /api/config/topics', () => {
  const patch = (b: unknown) =>
    PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(b) }), {})

  it('persists a seed description and logs config_change', async () => {
    await resetAndSeed(sql, { topics: [emerging] })
    const res = await patch({
      slug: 'gmp-grey-market',
      description: '  New description ',
      examplePhrases: ['GMP kya hai', 'gmp kya hai', ' ', 'kostak'],
    })
    expect(res.status).toBe(200)
    const [row] =
      await sql`select description, example_phrases from topics where slug = 'gmp-grey-market'`
    expect(row!.description).toBe('New description')
    expect(row!.example_phrases).toEqual(['GMP kya hai', 'kostak'])
    const ev = await events('config_change')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.detail).toEqual({
      target: 'topic',
      slug: 'gmp-grey-market',
      fields: ['description', 'examplePhrases'],
    })
  })

  it('404 unknown, 409 emerging and unclassified, 400 bad name', async () => {
    await resetAndSeed(sql, { topics: [emerging] })
    expect((await patch({ slug: 'nope', name: 'Valid name' })).status).toBe(404)
    expect((await patch({ slug: 'nri-quota', name: 'Valid name' })).status).toBe(409)
    expect((await patch({ slug: 'unclassified', name: 'Valid name' })).status).toBe(409)
    expect((await patch({ slug: 'gmp-grey-market', name: 'ab' })).status).toBe(400)
    expect(
      (await patch({ slug: 'gmp-grey-market', examplePhrases: Array(21).fill('x') })).status,
    ).toBe(400)
  })
})

describe('POST /api/topics/[slug]/promote', () => {
  it('promote flips kind and status and logs one promote_topic event', async () => {
    await resetAndSeed(sql, { topics: [emerging] })
    const res = await promote('nri-quota', { action: 'promote', name: 'NRI quota questions' })
    expect(res.status).toBe(200)
    const [t] =
      await sql`select kind, status, name, promoted_at, slug from topics where slug = 'nri-quota'`
    expect(t).toMatchObject({ kind: 'seed', status: 'active', name: 'NRI quota questions' })
    expect(t!.promoted_at).not.toBeNull()
    const ev = await events('promote_topic')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.detail).toEqual({ action: 'promote', slug: 'nri-quota' })
    expect(ev[0]!.actor).toBe('op@jio.local')
  })

  it('promoting a seed topic is 409; unknown is 404; bad action is 400', async () => {
    await resetAndSeed(sql, { topics: [emerging] })
    expect((await promote('gmp-grey-market', { action: 'promote' })).status).toBe(409)
    expect((await promote('missing', { action: 'promote' })).status).toBe(404)
    expect((await promote('nri-quota', { action: 'explode' })).status).toBe(400)
    expect(await events('promote_topic')).toHaveLength(0)
  })

  it('a dismissed topic cannot be promoted', async () => {
    await resetAndSeed(sql, { topics: [{ ...emerging, status: 'dismissed' }] })
    expect((await promote('nri-quota', { action: 'promote' })).status).toBe(409)
  })

  it('merge moves classifications and dismisses the source', async () => {
    await resetAndSeed(sql, {
      topics: [emerging],
      posts: many(3, () => ({ publishedAt: minutesAgo(10), labels: [{ topic: 'nri-quota' }] })),
    })
    const res = await promote('nri-quota', { action: 'merge', intoSlug: 'gmp-grey-market' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, movedClassifications: 3 })
    const moved = await sql`
      select count(*)::int as n from classifications c join topics t on t.id = c.topic_id
      where t.slug = 'gmp-grey-market'`
    expect(moved[0]!.n).toBe(3)
    const [src] = await sql`select status from topics where slug = 'nri-quota'`
    expect(src!.status).toBe('dismissed')
    expect((await events('promote_topic'))[0]!.detail).toEqual({
      action: 'merge',
      slug: 'nri-quota',
      intoSlug: 'gmp-grey-market',
      movedClassifications: 3,
    })
  })

  it('merge into itself is 400; into an emerging or unknown topic is rejected', async () => {
    await resetAndSeed(sql, {
      topics: [emerging, { slug: 'other-e', name: 'Other', kind: 'emerging' }],
    })
    expect((await promote('nri-quota', { action: 'merge', intoSlug: 'nri-quota' })).status).toBe(
      400,
    )
    expect((await promote('nri-quota', { action: 'merge', intoSlug: 'other-e' })).status).toBe(409)
    expect((await promote('nri-quota', { action: 'merge', intoSlug: 'zzz' })).status).toBe(404)
  })
})

describe('GET /api/config/audit', () => {
  const call = (cursor?: string) =>
    GET_AUDIT(
      new Request(
        `http://x/api/config/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      ),
      {},
    )

  it('excludes fetch_run, paginates 120 rows as 50/50/20 and redacts secrets', async () => {
    await resetAndSeed(sql, {
      fetchRuns: [{ sourceKey: 'reddit', at: minutesAgo(1), status: 'ok' }],
    })
    await sql`insert into event_log (at, kind, ip, detail)
      select now() - (g || ' seconds')::interval, 'view', '1.2.3.4', '{}'::jsonb
      from generate_series(10, 129) g`
    await sql`insert into event_log (at, kind, detail)
      values (now(), 'config_change', '{"bearerToken":"x","nested":{"api_secret":"y","ok":1}}'::jsonb)`
    const p1 = await (await call()).json()
    expect(p1.items).toHaveLength(50)
    expect(p1.items[0].kind).toBe('config_change')
    expect(p1.items[0].detail).toEqual({
      bearerToken: '[redacted]',
      nested: { api_secret: '[redacted]', ok: 1 },
    })
    const p2 = await (await call(p1.nextCursor)).json()
    expect(p2.items).toHaveLength(50)
    const p3 = await (await call(p2.nextCursor)).json()
    expect(p3.items).toHaveLength(21)
    expect(p3.nextCursor).toBeNull()
    const all = [...p1.items, ...p2.items, ...p3.items]
    expect(all.some((i: { kind: string }) => i.kind === 'fetch_run')).toBe(false)
    expect(new Set(all.map((i: { at: string }) => i.at)).size).toBe(all.length)
  })

  it('400 for a malformed cursor, 401 without session', async () => {
    expect((await call('garbage')).status).toBe(400)
    getSession.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
})
