// GET /api/evidence reader: the posts behind a number, keyset-paged. Author handles and names
// are selected only through a CASE on authors.kind, and author ids, platform ids, followers and
// raw_json are never selected; toEvidenceAuthor applies the same rule again on the way out.
import type {
  ClassificationOrigin,
  Confidence,
  EntityKey,
  EvidenceItem,
  EvidencePage,
  Lang,
  Lane,
  Sentiment,
  SourceKey,
} from '@jio/core'
import type { Fragment } from 'postgres'
import { iso, msToIso, type ReadCtx } from './ctx'
import { decodeCursor, encodeCursor, type Cursor } from './cursor'
import type { EvidenceParams } from './params'
import { toEvidenceAuthor } from './privacy'
import { range7d, windowRanges, type Range } from './window'

type EvidenceRow = {
  id: string
  source_key: SourceKey
  lane: Lane
  url: string
  text: string
  lang: Lang | null
  reach_score: number | null
  reach_raw: Record<string, number> | string | null
  published_ms: number
  published_key: string
  reach_key: number
  sentiment: Sentiment
  entities: EntityKey[] | null
  confidence: Confidence
  gloss_en: string | null
  origin: ClassificationOrigin
  topic_slug: string
  author_kind: string | null
  author_handle: string | null
  author_display_name: string | null
}

function timeRange(p: EvidenceParams, now: Date): Range {
  if (p.from && p.to) return { from: p.from, to: p.to }
  return p.window === '7d' ? range7d(now) : windowRanges(now).cur
}

function parseJson(v: EvidenceRow['reach_raw']): Record<string, number> {
  if (v == null) return {}
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, number>
    } catch {
      return {}
    }
  }
  return v
}

export async function getEvidence(ctx: ReadCtx, p: EvidenceParams): Promise<EvidencePage> {
  const { sql, now } = ctx
  const range = timeRange(p, now)
  const cursor: Cursor | undefined = p.cursor ? decodeCursor(p.cursor, p.sort) : undefined
  const none = sql``

  const topicFilter: Fragment =
    p.topic === 'emerging' || p.topic === 'unclassified'
      ? sql`and t.kind = ${p.topic}`
      : p.topic
        ? sql`and t.slug = ${p.topic}`
        : none

  const filters = sql`
    p.published_at >= ${iso(range.from)}::timestamptz
    and p.published_at < ${iso(range.to)}::timestamptz
    ${topicFilter}
    ${p.sentiment ? sql`and ec.sentiment = ${p.sentiment}` : none}
    ${p.entity !== 'all' ? sql`and ${p.entity}::text = any(ec.entities)` : none}
    ${p.lane !== 'all' ? sql`and p.lane = ${p.lane}` : none}
    ${p.source ? sql`and p.source_key = ${p.source}` : none}
    ${p.confidence === 'low' ? sql`and ec.confidence = 'low'` : none}`

  const reachKey = sql`coalesce(p.reach_score, 0)::float8`
  const after: Fragment = !cursor
    ? none
    : cursor.s === 'reach'
      ? sql`and (${reachKey}, p.published_at, p.id)
                < (${cursor.r}::float8, ${cursor.t}::timestamptz, ${cursor.id}::uuid)`
      : sql`and (p.published_at, p.id) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`
  const order =
    p.sort === 'reach'
      ? sql`order by ${reachKey} desc, p.published_at desc, p.id desc`
      : sql`order by p.published_at desc, p.id desc`

  const [rows, totals] = await Promise.all([
    sql<EvidenceRow[]>`
      select p.id, p.source_key, p.lane, p.url, p.text, p.lang,
             p.reach_score::float8 as reach_score, p.reach_raw,
             (extract(epoch from p.published_at) * 1000)::float8 as published_ms,
             to_char(p.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               as published_key,
             ${reachKey} as reach_key,
             ec.sentiment, ec.entities, ec.confidence, ec.gloss_en, ec.origin,
             t.slug as topic_slug,
             a.kind as author_kind,
             case when a.kind in ('media_outlet', 'public_figure') then a.handle end
               as author_handle,
             case when a.kind in ('media_outlet', 'public_figure') then a.display_name end
               as author_display_name
      from posts p
      join effective_classifications ec on ec.post_id = p.id
      join topics t on t.id = ec.topic_id
      left join authors a on a.id = p.author_id
      where ${filters} ${after}
      ${order}
      limit ${p.limit + 1}`,
    sql<{ n: number }[]>`
      select count(*)::int as n
      from posts p
      join effective_classifications ec on ec.post_id = p.id
      join topics t on t.id = ec.topic_id
      where ${filters}`,
  ])

  const page = rows.slice(0, p.limit)
  const last = page[page.length - 1]
  const nextCursor =
    rows.length > p.limit && last
      ? encodeCursor(
          p.sort === 'reach'
            ? { s: 'reach', r: Number(last.reach_key), t: last.published_key, id: last.id }
            : { s: 'newest', t: last.published_key, id: last.id },
        )
      : null

  const items: EvidenceItem[] = page.map((r) => ({
    postId: r.id,
    sourceKey: r.source_key,
    lane: r.lane,
    url: r.url,
    publishedAt: msToIso(r.published_ms)!,
    text: r.text,
    glossEn: r.gloss_en,
    lang: r.lang ?? 'other',
    reachScore: r.reach_score == null ? null : Number(r.reach_score),
    reachRaw: parseJson(r.reach_raw),
    sentiment: r.sentiment,
    topicSlug: r.topic_slug,
    entities: r.entities ?? [],
    confidence: r.confidence,
    origin: r.origin,
    author: toEvidenceAuthor(
      r.author_kind
        ? { kind: r.author_kind, handle: r.author_handle, displayName: r.author_display_name }
        : null,
      r.source_key,
    ),
  }))

  return { items, nextCursor, total: totals[0]?.n ?? 0 }
}
