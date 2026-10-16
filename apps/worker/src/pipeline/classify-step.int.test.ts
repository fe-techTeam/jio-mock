import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type NormalizedPost } from '@jio/core'
import { upsertPosts, upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import type { Classifier } from '../classify/classifier'
import { HashingEmbedder } from '../classify/embed-stub'
import { StubClassifier } from '../classify/stub'
import { createLogger } from '../log'
import { runClassifyBatch } from './classify-step'
import { loadFewShot } from './db'
import { createPipelineDeps, type PipelineDeps } from './deps'
import { StubSummarizer } from './summarizer'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_classify_step')
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
const terms = structuredClone(DEFAULT_CONFIG.terms)
const log = createLogger({ level: 'silent' })
const NOW = new Date('2026-10-20T06:00:00Z')

function post(id: string, text: string, minutes = 0): NormalizedPost {
  return {
    sourceKey: 'x_api',
    externalId: id,
    url: `https://x.com/u/status/${id}`,
    author: { platform: 'x', platformUserId: `u-${id}`, handle: `u${id}`, kind: 'other' },
    text,
    publishedAt: new Date(NOW.getTime() - 60 * 60_000 + minutes * 60_000),
    reachRaw: {},
    rawJson: { id },
  }
}

const RELEVANT = [
  'Jio IPO GMP kitna chal raha hai bhai? listing gain milega?',
  'Jio IPO valuation looks stretched at this price band, avoid',
  'Isha Ambani speaks about Jio Platforms IPO roadmap at the AGM',
  'जियो आईपीओ का प्राइस बैंड बहुत महंगा है',
  'Jio IPO allotment status kaise check kare? quota for RIL shareholders',
]
const NOISE = ['jio aur jeene do', 'JioHotstar new season streaming now, watch on JioHotstar']

function stubDeps(classifier?: Classifier): PipelineDeps {
  return {
    classifier: classifier ?? new StubClassifier({ terms }),
    embedder: new HashingEmbedder(),
    summarizer: new StubSummarizer(),
    log,
  }
}

function spy(inner: Classifier) {
  const calls: string[][] = []
  const c: Classifier = {
    model: inner.model,
    promptVersion: inner.promptVersion,
    classify: async (items, topics) => {
      calls.push(items.map((i) => i.postId))
      return inner.classify(items, topics)
    },
  }
  return { c, calls }
}

async function rowsByExternal() {
  return sql<
    {
      external_id: string
      origin: string
      slug: string
      entities: string[]
      model: string | null
      prompt_version: string | null
      created_at: string
    }[]
  >`
    select p.external_id, c.origin, t.slug, c.entities, c.model, c.prompt_version, c.created_at
    from classifications c join posts p on p.id = c.post_id join topics t on t.id = c.topic_id
    order by p.external_id, c.created_at`
}

describe('runClassifyBatch', () => {
  it('labels every relevant post once, leaves noise alone, and a second run does nothing', async () => {
    await upsertPosts(
      db,
      [...RELEVANT, ...NOISE].map((t, i) => post(String(i + 1), t, i)),
      { isFixture: true },
    )
    const deps = await createPipelineDeps(
      h(),
      { ANTHROPIC_API_KEY: '', VOYAGE_API_KEY: '' },
      { log },
    )
    expect(deps.classifier.model).toBe('stub-v1')
    expect(deps.embedder.model).toBe('hash-stub-v1')
    expect(deps.summarizer).toBeInstanceOf(StubSummarizer)

    const out = await runClassifyBatch(h(), deps, { now: NOW })
    expect(out).toMatchObject({ pending: 5, classified: 5, cacheHits: 0, failed: 0 })
    expect(out.triage).toMatchObject({ scanned: 7, relevant: 5, dropped: 2 })

    const rows = await rowsByExternal()
    expect(rows.map((r) => r.external_id)).toEqual(['1', '2', '3', '4', '5'])
    for (const r of rows) {
      expect(r.origin).toBe('model')
      expect(r.model).toBe('stub-v1')
      expect(new Date(r.created_at).toISOString()).toBe(NOW.toISOString())
    }
    // 'Isha Ambani' is in matched_terms, so isha is tagged whatever the model said.
    expect(rows.find((r) => r.external_id === '3')!.entities).toContain('isha')

    const again = await runClassifyBatch(h(), deps, { now: NOW })
    expect(again).toMatchObject({ pending: 0, classified: 0, failed: 0 })
    expect(await rowsByExternal()).toHaveLength(5)
  })

  it('adds entities from matched_terms even when the model returns none', async () => {
    await upsertPosts(db, [post('1', RELEVANT[2]!)], { isFixture: true })
    const none: Classifier = {
      model: 'm',
      promptVersion: 'p',
      classify: async (items) =>
        items.map((i) => ({
          postId: i.postId,
          topicSlug: 'not-a-topic',
          sentiment: 'neutral',
          entities: [],
          confidence: 'high',
          glossEn: null,
        })),
    }
    await runClassifyBatch(h(), stubDeps(none), { now: NOW })
    const [r] = await rowsByExternal()
    expect(r!.entities).toContain('isha')
    expect(r!.slug).toBe('unclassified') // unknown slug maps to the unclassified topic
    expect(r!.model).toBe('m')
    expect(r!.prompt_version).toBe('p')
  })

  it('labels a post sharing a content hash from the cache without calling the classifier', async () => {
    await upsertPosts(db, [post('1', RELEVANT[0]!)], { isFixture: true })
    await runClassifyBatch(h(), stubDeps(), { now: NOW })

    await upsertPosts(db, [post('2', RELEVANT[0]!, 5)], { isFixture: true })
    const { c, calls } = spy(new StubClassifier({ terms }))
    const out = await runClassifyBatch(h(), { ...stubDeps(c) }, { now: NOW })
    expect(out).toMatchObject({ pending: 1, classified: 1, cacheHits: 1, failed: 0 })
    expect(calls).toEqual([])

    const rows = await rowsByExternal()
    expect(rows).toHaveLength(2)
    expect(rows[1]!.slug).toBe(rows[0]!.slug)
    expect(rows[1]!.model).toBe(rows[0]!.model)
    expect(rows[1]!.prompt_version).toBe(rows[0]!.prompt_version)
  })

  it('loadFewShot returns analyst corrections, newest first', async () => {
    await upsertPosts(db, [post('1', RELEVANT[1]!)], { isFixture: true })
    await runClassifyBatch(h(), stubDeps(), { now: NOW })
    expect(await loadFewShot(h())).toEqual([])

    await sql`
      insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence, actor)
      select p.id, 'correction', t.id, 'negative', ${sql.array(['jio'])}::text[], 'high', 'analyst'
      from posts p, topics t where p.external_id = '1' and t.slug = 'gmp-grey-market'`
    const shots = await loadFewShot(h())
    expect(shots).toEqual([
      {
        text: RELEVANT[1],
        lang: 'en',
        topicSlug: 'gmp-grey-market',
        sentiment: 'negative',
        entities: ['jio'],
      },
    ])
  })

  it('a throwing classifier leaves posts pending and the step still resolves', async () => {
    await upsertPosts(
      db,
      RELEVANT.slice(0, 3).map((t, i) => post(String(i + 1), t, i)),
      { isFixture: true },
    )
    const broken: Classifier = {
      model: 'broken',
      promptVersion: 'x',
      classify: async () => {
        throw new Error('model down')
      },
    }
    const out = await runClassifyBatch(h(), stubDeps(broken), { now: NOW })
    expect(out.failed).toBe(3)
    expect(out.classified).toBe(0)
    expect(await rowsByExternal()).toHaveLength(0)

    const retry = await runClassifyBatch(h(), stubDeps(), { now: NOW })
    expect(retry).toMatchObject({ pending: 3, classified: 3, failed: 0 })
  })
})
