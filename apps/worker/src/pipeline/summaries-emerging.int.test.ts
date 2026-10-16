import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import { upsertSeedTopics, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import { HashingEmbedder, hashEmbed } from '../classify/embed-stub'
import { StubClassifier } from '../classify/stub'
import { createLogger } from '../log'
import { runRollup } from '../rollup'
import { toPgVector } from '../triage/vector'
import type { PipelineDeps } from './deps'
import { runEmerging } from './emerging'
import { runSummaries } from './summaries'
import { StubSummarizer } from './summarizer'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

let db: Db
let sql: ReturnType<typeof connectTestDb>['sql']

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_worker_summaries_emerging')
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
const NOW = new Date('2026-10-16T06:20:00Z')
const deps: PipelineDeps = {
  classifier: new StubClassifier({ terms: structuredClone(DEFAULT_CONFIG.terms) }),
  embedder: new HashingEmbedder(),
  summarizer: new StubSummarizer(),
  log: createLogger({ level: 'silent' }),
}

let seq = 0
async function author(handle: string): Promise<string> {
  const [r] = await sql<{ id: string }[]>`
    insert into authors (platform, platform_user_id, handle, delete_after)
    values ('x', ${handle}, ${handle}, ${new Date(NOW.getTime() + 90 * 86_400_000).toISOString()}::timestamptz)
    returning id`
  return r!.id
}

async function addPost(opts: {
  text: string
  authorId: string | null
  minutesAgo: number
  reach?: number | null
  embed?: boolean
}): Promise<string> {
  seq++
  const emb = opts.embed === false ? null : toPgVector(hashEmbed(opts.text))
  const at = new Date(NOW.getTime() - opts.minutesAgo * 60_000).toISOString()
  const [r] = await sql<{ id: string }[]>`
    insert into posts (source_key, external_id, url, author_id, lane, text, lang, published_at,
                       reach_score, content_hash, matched_terms, embedding)
    values ('x_api', ${`e${seq}`}, ${`https://x.com/s/${seq}`}, ${opts.authorId}, 'social',
            ${opts.text}, 'en', ${at}::timestamptz, ${opts.reach ?? null}, ${`h${seq}`},
            ${sql.array(['Jio IPO'])}::text[], ${emb}::vector)
    returning id`
  return r!.id
}

async function label(postId: string, slug: string, sentiment = 'neutral', confidence = 'low') {
  await sql`
    insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence, model,
                                 created_at)
    select ${postId}, 'model', t.id, ${sentiment}, ${sql.array(['jio'])}::text[], ${confidence},
           'stub-v1', ${new Date(NOW.getTime() - 10 * 60_000).toISOString()}::timestamptz
    from topics t where t.slug = ${slug}`
}

const SCAM = 'Fake Jio IPO allotment SMS links going around, lottery scam alert for retail'

async function seedScamCluster() {
  const authors = await Promise.all(['a1', 'a2', 'a3', 'a4'].map(author))
  const ids: string[] = []
  for (let i = 0; i < 6; i++) {
    const id = await addPost({
      text: `${SCAM} ${['today', 'again', 'now', 'pls', 'beware', 'friends'][i]}`,
      authorId: authors[i % 4]!,
      minutesAgo: 60 + i * 10,
    })
    await label(id, 'unclassified', i % 2 ? 'negative' : 'neutral')
    ids.push(id)
  }
  return ids
}

async function unclassifiedItems(): Promise<number> {
  const [r] = await sql<{ n: number }[]>`
    select coalesce(sum(s.items), 0)::int as n
    from topic_stats_15m s join topics t on t.id = s.topic_id
    where t.slug = 'unclassified' and s.entity = 'all' and s.lane = 'all'`
  return r!.n
}

describe('runEmerging', () => {
  it('turns 6 near-identical unclassified posts from 4 authors into one emerging topic', async () => {
    const ids = await seedScamCluster()
    // A far, lone unclassified post and an old one stay where they are.
    const lone = await addPost({
      text: 'Completely different words about tariffs',
      authorId: null,
      minutesAgo: 30,
    })
    await label(lone, 'unclassified')
    const old = await addPost({ text: `${SCAM} old`, authorId: null, minutesAgo: 73 * 60 })
    await label(old, 'unclassified')

    await runRollup(h(), NOW, { mode: 'full7d' })
    expect(await unclassifiedItems()).toBe(8)

    const out = await runEmerging(h(), deps, NOW)
    expect(out).toMatchObject({ candidates: 1, created: 1, attached: 0, labelled: 6 })

    const topics = await sql<
      { slug: string; name: string; kind: string; status: string; example_phrases: string[] }[]
    >`select slug, name, kind, status, example_phrases from topics
      where kind = 'emerging' and slug <> 'emerging'`
    expect(topics).toHaveLength(1)
    const t = topics[0]!
    expect(t.slug).toMatch(/^emerging-20261016-[0-9a-f]{6}$/)
    expect(t.name).toMatch(/^Emerging: \S+ \S+$/)
    expect(t.status).toBe('active')
    expect(t.example_phrases).toHaveLength(3)

    const members = await sql<{ post_id: string; model: string; prompt_version: string }[]>`
      select ec.post_id, ec.model, ec.prompt_version
      from effective_classifications ec join topics t on t.id = ec.topic_id
      where t.slug = ${t.slug}`
    expect(members.map((m) => m.post_id).sort()).toEqual([...ids].sort())
    for (const m of members) {
      expect(m.model).toBe('emerging-cluster')
      expect(m.prompt_version).toBe('emerging-v1')
    }

    await runRollup(h(), NOW, { mode: 'full7d' })
    expect(await unclassifiedItems()).toBe(2)

    // A second run on the same data is a no-op.
    const again = await runEmerging(h(), deps, NOW)
    expect(again).toMatchObject({ created: 0, attached: 0, labelled: 0 })
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n from topics where kind = 'emerging'`
    expect(count!.n).toBe(2)
  })

  it('attaches a new matching cluster to the existing emerging topic', async () => {
    await seedScamCluster()
    await runEmerging(h(), deps, NOW)
    const authors = await Promise.all(['b1', 'b2', 'b3'].map(author))
    for (let i = 0; i < 5; i++) {
      const id = await addPost({
        text: `${SCAM} ${['late', 'still', 'more', 'again2', 'yet'][i]}`,
        authorId: authors[i % 3]!,
        minutesAgo: 5 + i,
      })
      await label(id, 'unclassified')
    }
    const out = await runEmerging(h(), deps, NOW)
    expect(out).toMatchObject({ candidates: 1, created: 0, attached: 1, labelled: 5 })
  })

  it('rejects clusters with too few authors and never targets the generic emerging row', async () => {
    const a = await author('solo')
    for (let i = 0; i < 6; i++) {
      const id = await addPost({ text: `${SCAM} ${i}`, authorId: a, minutesAgo: 10 + i })
      await label(id, 'unclassified')
    }
    const out = await runEmerging(h(), deps, NOW)
    expect(out).toMatchObject({ candidates: 0, created: 0, labelled: 0 })
  })
})

describe('runSummaries', () => {
  it('writes two stub lines and summary_at for active topics only', async () => {
    for (let i = 0; i < 3; i++) {
      const id = await addPost({
        text: `Jio IPO GMP update number ${i}`,
        authorId: null,
        minutesAgo: 30 + i,
        reach: i,
      })
      await label(id, 'gmp-grey-market', 'positive', 'high')
    }
    await sql`update topics set status = 'active' where slug = 'gmp-grey-market'`
    await sql`update topics set status = 'dormant'
              where kind = 'seed' and slug <> 'gmp-grey-market'`

    const out = await runSummaries(h(), deps, NOW)
    expect(out).toMatchObject({ summarized: 1, failed: 0 })

    const [t] = await sql<{ summary_2line: string; summary_at: string }[]>`
      select summary_2line, summary_at from topics where slug = 'gmp-grey-market'`
    const lines = t!.summary_2line.split('\n')
    expect(lines).toEqual([
      '3 items in 24h (too few for a sentiment split).',
      'Most-reached: "Jio IPO GMP update number 2"',
    ])
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(140)
    expect(new Date(t!.summary_at).toISOString()).toBe(NOW.toISOString())

    const others = await sql<{ n: number }[]>`
      select count(*)::int as n from topics where summary_2line is not null`
    expect(others[0]!.n).toBe(1)
  })

  it('summarizes an emerging topic with at least 3 items and skips a failing topic', async () => {
    await seedScamCluster()
    await runEmerging(h(), deps, NOW)
    const failing: PipelineDeps = {
      ...deps,
      summarizer: {
        model: 'broken',
        summarize: async () => {
          throw new Error('summary down')
        },
      },
    }
    const bad = await runSummaries(h(), failing, NOW)
    expect(bad).toMatchObject({ summarized: 0, failed: 1 })

    const ok = await runSummaries(h(), deps, NOW)
    expect(ok).toMatchObject({ summarized: 1, failed: 0 })
    const [t] = await sql<{ summary_2line: string }[]>`
      select summary_2line from topics where kind = 'emerging' and slug <> 'emerging'`
    expect(t!.summary_2line.split('\n')[0]).toBe('6 items in 24h (too few for a sentiment split).')
  })
})
