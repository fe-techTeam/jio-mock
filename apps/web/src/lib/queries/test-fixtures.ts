// Test-only seeding for the read-layer integration tests. Never imported by app code.
// `resetAndSeed` truncates the dashboard tables and inserts compact specs. By default it also
// derives topic_stats_15m rows from the posts' effective labels (the same fan-out as the worker
// rollup: entity 'all' + each entity, lane 'all' + the post's lane), so counts stay consistent.
import {
  DEFAULT_CONFIG,
  SEED_TOPICS,
  SOURCE_DEFAULT_LANE,
  type AppConfig,
  type AuthorKind,
  type ClassificationOrigin,
  type Confidence,
  type EntityFilter,
  type EntityKey,
  type Lane,
  type LaneFilter,
  type Lang,
  type MarketSeries,
  type Sentiment,
  type SourceKey,
  type TopicKind,
  type TopicStatus,
} from '@jio/core'
import type { Sql } from 'postgres'
import { floor15 } from './window'

/** Friday 2026-10-16 13:30 IST (inside Indian market hours). */
export const NOW = new Date('2026-10-16T08:00:00Z')

export const minutesAgo = (m: number, now: Date = NOW) => new Date(now.getTime() - m * 60_000)
export const hoursAgo = (h: number, now: Date = NOW) => minutesAgo(h * 60, now)

export type TopicSpec = {
  slug: string
  name?: string
  kind?: TopicKind
  status?: TopicStatus
  summary2line?: string | null
  summaryAt?: Date | null
}

export type AuthorSpec = {
  key: string
  kind?: AuthorKind
  handle?: string | null
  displayName?: string | null
  platform?: string
  followers?: number | null
}

export type LabelSpec = {
  topic: string
  origin?: ClassificationOrigin
  sentiment?: Sentiment
  entities?: EntityKey[]
  confidence?: Confidence
  glossEn?: string | null
  createdAt?: Date
}

export type PostSpec = {
  sourceKey?: SourceKey
  lane?: Lane
  publishedAt: Date
  /** AuthorSpec key, or null for no author. */
  author?: string | null
  text?: string
  url?: string
  lang?: Lang
  reachScore?: number | null
  reachRaw?: Record<string, number>
  rawJson?: unknown
  labels: LabelSpec[]
}

export type StatSpec = {
  topic: string
  bucketStart: Date
  entity?: EntityFilter
  lane?: LaneFilter
  items: number
  pos?: number
  neu?: number
  neg?: number
  lowConf?: number
  suspectedCoordinated?: number
}

export type MarketSpec = {
  series: MarketSeries
  value: number
  observedAt: Date
  sourceKey?: SourceKey
  sourceUrl?: string
}

export type FetchRunSpec = { sourceKey: SourceKey; at: Date; status: 'ok' | 'error' }

export type SeedSpec = {
  /** Added to (or overriding by slug) the 12 SEED_TOPICS. */
  topics?: TopicSpec[]
  authors?: AuthorSpec[]
  posts?: PostSpec[]
  /** Extra rollup rows, added onto the derived ones. */
  stats?: StatSpec[]
  /** Derive rollup rows from posts (default true). */
  rollup?: boolean
  market?: MarketSpec[]
  fetchRuns?: FetchRunSpec[]
  config?: (c: AppConfig) => void
}

export type Seeded = {
  topicIds: Record<string, string>
  authorIds: Record<string, string>
  /** In spec order. */
  postIds: string[]
}

const DASHBOARD_TABLES = [
  'topic_stats_15m',
  'classifications',
  'posts',
  'authors',
  'topics',
  'market_points',
  'config_versions',
  'event_log',
]

const ts = (d: Date) => d.toISOString()

/** Same bucket key as the worker rollup. */
type Agg = { items: number; pos: number; neu: number; neg: number; lowConf: number; sc: number }

function effectiveLabel(labels: LabelSpec[], createdAt: (i: number) => Date): LabelSpec | null {
  const indexed = labels.map((l, i) => ({ l, at: (l.createdAt ?? createdAt(i)).getTime(), i }))
  const human = indexed.filter((x) => x.l.origin === 'correction' || x.l.origin === 'gold')
  const pool = human.length > 0 ? human : indexed
  pool.sort((a, b) => b.at - a.at || b.i - a.i)
  return pool[0]?.l ?? null
}

export async function resetAndSeed(sql: Sql, spec: SeedSpec = {}): Promise<Seeded> {
  await sql.unsafe(
    `truncate table ${DASHBOARD_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  )

  const config = structuredClone(DEFAULT_CONFIG)
  spec.config?.(config)
  await sql`insert into config_versions (version, actor, config)
            values (1, 'test', ${JSON.stringify(config)}::jsonb)`

  const topicSpecs = new Map<string, TopicSpec>()
  for (const t of SEED_TOPICS) topicSpecs.set(t.slug, { slug: t.slug, name: t.name, kind: t.kind })
  for (const t of spec.topics ?? []) topicSpecs.set(t.slug, { ...topicSpecs.get(t.slug), ...t })

  const topicIds: Record<string, string> = {}
  for (const t of topicSpecs.values()) {
    const [row] = await sql<{ id: string }[]>`
      insert into topics (slug, name, kind, status, summary_2line, summary_at)
      values (${t.slug}, ${t.name ?? t.slug}, ${t.kind ?? 'seed'}, ${t.status ?? 'active'},
              ${t.summary2line ?? null}, ${t.summaryAt ? ts(t.summaryAt) : null}::timestamptz)
      returning id`
    topicIds[t.slug] = row!.id
  }

  const authorIds: Record<string, string> = {}
  for (const a of spec.authors ?? []) {
    const [row] = await sql<{ id: string }[]>`
      insert into authors (platform, platform_user_id, handle, display_name, followers, kind,
                           delete_after)
      values (${a.platform ?? 'x'}, ${'uid-' + a.key}, ${a.handle ?? null},
              ${a.displayName ?? null}, ${a.followers ?? null}, ${a.kind ?? 'other'},
              ${ts(new Date(NOW.getTime() + 90 * 86_400_000))}::timestamptz)
      returning id`
    authorIds[a.key] = row!.id
  }

  const labelCreatedAt = (i: number) => new Date(NOW.getTime() - 3_600_000 + i * 1000)
  const agg = new Map<string, Agg & { topic: string; bucket: Date; entity: string; lane: string }>()
  const bump = (topic: string, bucket: Date, entity: string, lane: string, d: Partial<Agg>) => {
    const k = `${topic}|${bucket.getTime()}|${entity}|${lane}`
    const cur = agg.get(k) ?? {
      topic,
      bucket,
      entity,
      lane,
      items: 0,
      pos: 0,
      neu: 0,
      neg: 0,
      lowConf: 0,
      sc: 0,
    }
    cur.items += d.items ?? 0
    cur.pos += d.pos ?? 0
    cur.neu += d.neu ?? 0
    cur.neg += d.neg ?? 0
    cur.lowConf += d.lowConf ?? 0
    cur.sc += d.sc ?? 0
    agg.set(k, cur)
  }

  const postIds: string[] = []
  for (const [i, p] of (spec.posts ?? []).entries()) {
    const sourceKey = p.sourceKey ?? 'reddit'
    const lane = p.lane ?? SOURCE_DEFAULT_LANE[sourceKey]
    const authorId: string | null = p.author ? (authorIds[p.author] ?? null) : null
    if (p.author && !authorId) throw new Error(`unknown author key ${p.author}`)
    const [row] = await sql<{ id: string }[]>`
      insert into posts (source_key, external_id, url, author_id, lane, text, lang, published_at,
                         reach_raw, reach_score, raw_json, content_hash)
      values (${sourceKey}, ${'ext-' + i}, ${p.url ?? `https://example.test/${i}`}, ${authorId},
              ${lane}, ${p.text ?? `post ${i}`}, ${p.lang ?? 'en'}, ${ts(p.publishedAt)}::timestamptz,
              ${JSON.stringify(p.reachRaw ?? {})}::jsonb, ${p.reachScore ?? null},
              ${JSON.stringify(p.rawJson ?? { secret: 'raw-json-marker' })}::jsonb, ${'hash-' + i})
      returning id`
    const postId = row!.id
    postIds.push(postId)
    for (const [j, l] of p.labels.entries()) {
      const topicId = topicIds[l.topic]
      if (!topicId) throw new Error(`unknown topic ${l.topic}`)
      await sql`
        insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence,
                                     gloss_en, created_at)
        values (${postId}, ${l.origin ?? 'model'}, ${topicId}, ${l.sentiment ?? 'neutral'},
                coalesce(string_to_array(nullif(${(l.entities ?? []).join(',')}, ''), ','), '{}'),
                ${l.confidence ?? 'high'}, ${l.glossEn ?? null},
                ${ts(l.createdAt ?? labelCreatedAt(j))}::timestamptz)`
    }
    if (spec.rollup === false) continue
    const eff = effectiveLabel(p.labels, labelCreatedAt)
    if (!eff) continue
    const bucket = floor15(p.publishedAt)
    const s = eff.sentiment ?? 'neutral'
    const d: Partial<Agg> = {
      items: 1,
      pos: s === 'positive' ? 1 : 0,
      neu: s === 'neutral' ? 1 : 0,
      neg: s === 'negative' ? 1 : 0,
      lowConf: eff.confidence === 'low' ? 1 : 0,
    }
    for (const entity of ['all', ...new Set(eff.entities ?? [])]) {
      for (const l of ['all', lane]) bump(eff.topic, bucket, entity, l, d)
    }
  }

  for (const s of spec.stats ?? []) {
    bump(s.topic, s.bucketStart, s.entity ?? 'all', s.lane ?? 'all', {
      items: s.items,
      pos: s.pos ?? 0,
      neu: s.neu ?? 0,
      neg: s.neg ?? 0,
      lowConf: s.lowConf ?? 0,
      sc: s.suspectedCoordinated ?? 0,
    })
  }
  for (const r of agg.values()) {
    const topicId = topicIds[r.topic]
    if (!topicId) throw new Error(`unknown topic ${r.topic}`)
    await sql`
      insert into topic_stats_15m (bucket_start, topic_id, entity, lane, items, pos, neu, neg,
                                   low_conf, suspected_coordinated)
      values (${ts(r.bucket)}::timestamptz, ${topicId}, ${r.entity}, ${r.lane}, ${r.items}, ${r.pos},
              ${r.neu}, ${r.neg}, ${r.lowConf}, ${r.sc})`
  }

  for (const m of spec.market ?? []) {
    const sourceKey = m.sourceKey ?? 'portal_chittorgarh'
    await sql`
      insert into market_points (series, value, observed_at, source_key, source_url)
      values (${m.series}, ${m.value}, ${ts(m.observedAt)}::timestamptz, ${sourceKey},
              ${m.sourceUrl ?? `https://${sourceKey}.example/jio`})`
  }

  for (const f of spec.fetchRuns ?? []) {
    await sql`
      insert into event_log (at, kind, source_key, status, items_new, cost_usd, duration_ms, error)
      values (${ts(f.at)}::timestamptz, 'fetch_run', ${f.sourceKey}, ${f.status}, 0, 0, 100,
              ${f.status === 'error' ? 'boom' : null})`
  }

  return { topicIds, authorIds, postIds }
}

/** n posts built by `make(i)`. */
export function many(n: number, make: (i: number) => PostSpec): PostSpec[] {
  return Array.from({ length: n }, (_, i) => make(i))
}
