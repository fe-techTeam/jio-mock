// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type TermsConfig } from '@jio/core'
import type { Db } from '@jio/db'
import { connectTestDb, prepareTestDb } from '@jio/db/testing'
import type { Sql } from 'postgres'

const h = vi.hoisted(() => ({ db: null as unknown, sql: null as unknown }))
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }))
vi.mock('@/lib/db', () => ({ getDb: () => ({ db: h.db, sql: h.sql }) }))

import { auth } from '@/lib/auth'
import { NOW, resetAndSeed } from '@/lib/queries/test-fixtures'
import { GET, PATCH } from './route'
import { POST as TEST_TERMS } from './test-terms/route'
import { validateRetention, validateTerms } from './_lib/validate'

const getSession = vi.mocked(auth.api.getSession)
const SESSION = { user: { email: 'op@jio.local' }, session: {} } as unknown as Awaited<
  ReturnType<typeof auth.api.getSession>
>

let db: Db
let sql: Sql
beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web_settings_config')
  ;({ db, sql } = connectTestDb(url))
  h.db = db
  h.sql = sql
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(async () => {
  getSession.mockReset().mockResolvedValue(SESSION)
  await resetAndSeed(sql)
})

const terms = (f: (t: TermsConfig) => void = () => {}): TermsConfig => {
  const t = structuredClone(DEFAULT_CONFIG.terms)
  f(t)
  return t
}
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost:3100/api/config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    {},
  )
const paths = (r: ReturnType<typeof validateTerms>) => r.errors.map((e) => e.path)

describe('validateTerms', () => {
  it('accepts the shipped defaults', () => {
    const r = validateTerms(terms())
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('rejects a bare jio alias with the explanation', () => {
    const r = validateTerms(terms((t) => t.entities.jio.aliases.push('jio')))
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.message).toContain("'jio' alone means 'live' in Hindi")
  })

  it.each(['जियो', 'જિયો', 'Reliance', 'ambani', 'अंबानी', 'અંબાણી'])('rejects bare %s', (w) => {
    expect(validateTerms(terms((t) => t.ipo_terms.push(w))).ok).toBe(false)
    expect(validateTerms(terms((t) => t.cooccurrence_terms.push(w))).ok).toBe(false)
  })

  it('accepts #JioIPO and prepends # to JioIPO', () => {
    const r = validateTerms(terms((t) => (t.hashtags = ['#JioIPO', 'JioIPO2'])))
    expect(r.normalized.hashtags).toEqual(['#JioIPO', '#JioIPO2'])
  })

  it('rejects invalid hashtags, empty and over-long terms', () => {
    expect(validateTerms(terms((t) => (t.hashtags = ['#a b!']))).ok).toBe(false)
    expect(validateTerms(terms((t) => t.ipo_terms.push('   '))).ok).toBe(false)
    expect(validateTerms(terms((t) => t.ipo_terms.push('x'.repeat(81)))).ok).toBe(false)
  })

  it('rejects a case-insensitive duplicate and names it', () => {
    const r = validateTerms(terms((t) => (t.cooccurrence_terms = ['GMP', 'gmp'])))
    expect(r.ok).toBe(false)
    expect(r.errors[0]?.message).toContain("'gmp'")
  })

  it('collapses whitespace and NFC-normalizes', () => {
    const r = validateTerms(terms((t) => (t.ipo_terms = ['  Jio   IPO  ', 'Café IPO'])))
    expect(r.normalized.ipo_terms).toEqual(['Jio IPO', 'Café IPO'])
  })

  it('rejects a term present in both include and negative lists', () => {
    const r = validateTerms(
      terms((t) => {
        t.hashtags = ['#JioStar']
        t.negative_terms = ['JioStar']
      }),
    )
    expect(r.ok).toBe(false)
    expect(paths(r)).toContain('hashtags[0]')
  })

  it('needs one alias per entity and one co-occurrence term, and caps lists at 500', () => {
    expect(validateTerms(terms((t) => (t.entities.akash.aliases = []))).ok).toBe(false)
    expect(validateTerms(terms((t) => (t.cooccurrence_terms = []))).ok).toBe(false)
    const many = Array.from({ length: 501 }, (_, i) => `term ${i}`)
    expect(validateTerms(terms((t) => (t.negative_terms = many))).ok).toBe(false)
  })
})

describe('validateRetention', () => {
  it('rejects raw 120 over text 90', () => {
    expect(validateRetention({ raw_json: 120, post_text: 90, authors: 90 })).not.toEqual([])
  })
  it('rejects 0, 3651 and fractions; accepts 30/90/90', () => {
    expect(validateRetention({ raw_json: 0, post_text: 90, authors: 90 })).not.toEqual([])
    expect(validateRetention({ raw_json: 30, post_text: 3651, authors: 90 })).not.toEqual([])
    expect(validateRetention({ raw_json: 30, post_text: 90, authors: 1.5 })).not.toEqual([])
    expect(validateRetention({ raw_json: 30, post_text: 90, authors: 90 })).toEqual([])
  })
})

describe('/api/config', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET(new Request('http://x/api/config'), {})).status).toBe(401)
    expect((await patch({ baseVersion: 1 })).status).toBe(401)
    expect(
      (
        await TEST_TERMS(
          new Request('http://x', { method: 'POST', body: JSON.stringify({ terms: terms() }) }),
          {},
        )
      ).status,
    ).toBe(401)
  })

  it('GET returns terms and retention without sources or creds', async () => {
    const body = await (await GET(new Request('http://x/api/config'), {})).json()
    expect(body).toMatchObject({
      version: 1,
      retentionDays: { raw_json: 30, post_text: 90, authors: 90 },
      minItemsForSplit: 30,
      activeMinItems24h: 10,
      personLevelViews: false,
    })
    expect(body).not.toHaveProperty('sources')
    expect(JSON.stringify(body)).not.toContain('creds')
  })

  it('PATCH writes version N+1, one config_change event, and leaves sources untouched', async () => {
    const before = (await sql`select config from config_versions where version = 1`)[0]!.config
    const res = await patch({
      baseVersion: 1,
      terms: terms((t) => t.ipo_terms.push('Jio IPO subscription day 3')),
      retentionDays: { raw_json: 20, post_text: 60, authors: 60 },
    })
    expect(res.status).toBe(200)
    expect((await res.json()).version).toBe(2)
    const rows = await sql`select version, config from config_versions order by version`
    expect(rows.map((r) => r.version)).toEqual([1, 2])
    expect(rows[1]!.config.sources).toEqual(before.sources)
    expect(rows[1]!.config.person_level_views).toBe(false)
    expect(rows[1]!.config.retention_days.post_text).toBe(60)
    expect(rows[1]!.config.terms.ipo_terms).toContain('Jio IPO subscription day 3')
    const ev = await sql`select actor from event_log where kind = 'config_change'`
    expect(ev).toHaveLength(1)
    expect(ev[0]!.actor).toBe('op@jio.local')
  })

  it('409 on a stale baseVersion and writes nothing', async () => {
    await patch({ baseVersion: 1, minItemsForSplit: 40 })
    const res = await patch({ baseVersion: 1, minItemsForSplit: 50 })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: 'Config changed since you opened it, reload',
    })
    expect(await sql`select 1 from config_versions`).toHaveLength(2)
  })

  it('400 for invalid terms with the validator errors', async () => {
    const res = await patch({
      baseVersion: 1,
      terms: terms((t) => t.entities.jio.aliases.push('jio')),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('validation_failed')
    expect(body.issues[0].message).toContain("'jio' alone")
    expect(await sql`select 1 from config_versions`).toHaveLength(1)
  })

  it('400 for a personLevelViews key whatever its value', async () => {
    for (const body of [
      { baseVersion: 1, personLevelViews: true },
      { baseVersion: 1, person_level_views: true },
      { baseVersion: 1, personLevelViews: false },
    ]) {
      const res = await patch(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('person-level views are locked pending legal review')
    }
    expect(await sql`select 1 from config_versions`).toHaveLength(1)
  })

  it('400 for out-of-range thresholds', async () => {
    expect((await patch({ baseVersion: 1, minItemsForSplit: 0 })).status).toBe(400)
    expect((await patch({ baseVersion: 1, activeMinItems24h: 10001 })).status).toBe(400)
  })
})

describe('POST /api/config/test-terms', () => {
  const call = (body: unknown) =>
    TEST_TERMS(
      new Request('http://x/api/config/test-terms', { method: 'POST', body: JSON.stringify(body) }),
      {},
    )

  it('counts matches in the last 24h for current and draft terms, with no author fields', async () => {
    const recent = new Date(Date.now() - 3_600_000)
    await resetAndSeed(sql, {
      posts: [
        { publishedAt: NOW, text: 'Jio IPO GMP kitna?', labels: [] },
        { publishedAt: NOW, text: 'khul ke jio', labels: [] },
        { publishedAt: NOW, text: 'Jio Moonshot is wild', labels: [] },
      ],
    })
    await sql`update posts set fetched_at = ${recent.toISOString()}::timestamptz`
    await sql`insert into posts (source_key, external_id, url, lane, text, published_at, fetched_at)
      values ('reddit', 'old', 'https://x.test/old', 'social', 'Jio IPO GMP old', now(), now() - interval '3 days')`
    const res = await call({
      terms: terms((t) => t.ipo_terms.push('Jio Moonshot')),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ total: 3, matchedCurrent: 1, matchedDraft: 2, truncated: false })
    expect(body.samples).toHaveLength(1)
    expect(Object.keys(body.samples[0]).sort()).toEqual(['publishedAt', 'sourceKey', 'text'])
  })

  it('400 for invalid draft terms', async () => {
    const res = await call({ terms: terms((t) => t.ipo_terms.push('jio')) })
    expect(res.status).toBe(400)
  })
})
