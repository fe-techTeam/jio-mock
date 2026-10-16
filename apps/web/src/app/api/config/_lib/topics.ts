// Settings topic management on the raw postgres-js handle (the web app has no drizzle-orm
// dependency of its own). Writes and their event_log row share one transaction.
import type { Sql } from 'postgres'
import type {
  AuditItem,
  AuditResponse,
  ConfigTopicsResponse,
  EmergingRow,
  SeedTopicRow,
  TopicPatch,
} from './contract'
import { msToIso } from '@/lib/queries/ctx'

/** A rejected request with the status to return. */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

const CATCH_ALL_EMERGING = 'emerging'
const clip = (s: string, n = 200) => s.slice(0, n)

type TopicRow = {
  id: string
  slug: string
  name: string
  description: string
  example_phrases: string[]
  status: string
  kind: string
  created_ms: number
  items24h: number
}

export async function listConfigTopics(sql: Sql): Promise<ConfigTopicsResponse> {
  const rows = await sql<TopicRow[]>`
    select t.id, t.slug, t.name, t.description, t.example_phrases, t.status, t.kind,
           extract(epoch from t.created_at) * 1000 as created_ms,
           count(p.id)::int as items24h
    from topics t
    left join effective_classifications ec on ec.topic_id = t.id
    left join posts p on p.id = ec.post_id and p.published_at >= now() - interval '24 hours'
    where t.status <> 'dismissed'
    group by t.id
    order by t.created_at, t.slug`
  const seedOrder = new Map<string, number>()
  const seed: SeedTopicRow[] = []
  const emergingTopics: TopicRow[] = []
  let unclassified = 0
  for (const r of rows) {
    if (r.kind === 'seed') {
      seedOrder.set(r.slug, seed.length)
      seed.push({
        slug: r.slug,
        name: r.name,
        description: r.description,
        examplePhrases: r.example_phrases,
        status: r.status,
        items24h: Number(r.items24h),
      })
    } else if (r.kind === 'emerging') {
      // The catch-all 'emerging' bucket is not a candidate; candidates are its sibling rows.
      if (r.slug !== CATCH_ALL_EMERGING) emergingTopics.push(r)
    } else if (r.kind === 'unclassified') unclassified += Number(r.items24h)
  }

  const emerging: EmergingRow[] = []
  for (const t of emergingTopics) {
    const samples = await sql<
      {
        text: string
        source_key: string
        ms: number
        lang: string | null
        gloss_en: string | null
      }[]
    >`
      select p.text, p.source_key, extract(epoch from p.published_at) * 1000 as ms, p.lang,
             ec.gloss_en
      from effective_classifications ec
      join posts p on p.id = ec.post_id
      where ec.topic_id = ${t.id}
      order by p.published_at desc
      limit 3`
    emerging.push({
      slug: t.slug,
      name: t.name,
      description: t.description,
      createdAt: msToIso(t.created_ms) ?? '',
      items24h: Number(t.items24h),
      samples: samples.map((s) => ({
        text: clip(s.text),
        sourceKey: s.source_key,
        publishedAt: msToIso(s.ms) ?? '',
        lang: s.lang,
        glossEn: s.gloss_en,
      })),
    })
  }
  emerging.sort((a, b) => b.items24h - a.items24h)
  return { seed, emerging, unclassified: { count24h: unclassified } }
}

type Actor = { actor: string; ip: string }

export function validateTopicPatch(p: TopicPatch): { fields: string[]; patch: TopicPatch } {
  const out: TopicPatch = { slug: p.slug }
  const fields: string[] = []
  if (p.name !== undefined) {
    const n = p.name.normalize('NFC').trim().replace(/\s+/g, ' ')
    if (n.length < 3 || n.length > 80) throw new HttpError(400, 'name must be 3 to 80 characters')
    out.name = n
    fields.push('name')
  }
  if (p.description !== undefined) {
    const d = p.description.normalize('NFC').trim()
    if (d.length > 500) throw new HttpError(400, 'description must be at most 500 characters')
    out.description = d
    fields.push('description')
  }
  if (p.examplePhrases !== undefined) {
    if (p.examplePhrases.length > 20) throw new HttpError(400, 'at most 20 example phrases')
    const seen = new Set<string>()
    const phrases: string[] = []
    for (const raw of p.examplePhrases) {
      const s = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
      if (!s) continue
      if (s.length > 200)
        throw new HttpError(400, 'each example phrase must be at most 200 characters')
      if (seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      phrases.push(s)
    }
    out.examplePhrases = phrases
    fields.push('examplePhrases')
  }
  if (fields.length === 0) throw new HttpError(400, 'nothing to update')
  return { fields, patch: out }
}

/** Seed topics only. Last write wins: topics have no version column. */
export async function patchSeedTopic(sql: Sql, p: TopicPatch, who: Actor): Promise<void> {
  const { fields, patch } = validateTopicPatch(p)
  await sql.begin(async (tx) => {
    const [t] = await tx<{ id: string; kind: string }[]>`
      select id, kind from topics where slug = ${patch.slug} for update`
    if (!t) throw new HttpError(404, 'unknown topic')
    if (t.kind !== 'seed') throw new HttpError(409, 'only seed topics can be edited here')
    await tx`
      update topics set
        name = coalesce(${patch.name ?? null}, name),
        description = coalesce(${patch.description ?? null}, description),
        example_phrases = coalesce(${patch.examplePhrases ?? null}::text[], example_phrases)
      where id = ${t.id}`
    await tx`
      insert into event_log (kind, actor, ip, detail)
      values ('config_change', ${who.actor}, ${who.ip},
              ${JSON.stringify({ target: 'topic', slug: patch.slug, fields })}::jsonb)`
  })
}

export type PromoteAction =
  | { action: 'promote'; name?: string; description?: string }
  | { action: 'merge'; intoSlug: string }
  | { action: 'dismiss' }

export async function applyPromotion(
  sql: Sql,
  slug: string,
  body: PromoteAction,
  who: Actor,
): Promise<{ ok: true; movedClassifications?: number }> {
  return sql.begin(async (tx) => {
    const [src] = await tx<{ id: string; slug: string; kind: string; status: string }[]>`
      select id, slug, kind, status from topics where slug = ${slug} for update`
    if (!src) throw new HttpError(404, 'unknown topic')
    if (src.kind !== 'emerging' || src.slug === CATCH_ALL_EMERGING || src.status === 'dismissed') {
      throw new HttpError(409, 'only an active Emerging topic can be promoted, merged or dismissed')
    }
    const log = (detail: Record<string, unknown>) =>
      tx`insert into event_log (kind, actor, ip, detail)
         values ('promote_topic', ${who.actor}, ${who.ip}, ${JSON.stringify({ ...detail, slug })}::jsonb)`

    if (body.action === 'promote') {
      const name = body.name?.normalize('NFC').trim().replace(/\s+/g, ' ')
      const description = body.description?.normalize('NFC').trim()
      if (name !== undefined && (name.length < 3 || name.length > 80)) {
        throw new HttpError(400, 'name must be 3 to 80 characters')
      }
      if (description !== undefined && description.length > 500) {
        throw new HttpError(400, 'description must be at most 500 characters')
      }
      await tx`
        update topics set kind = 'seed', status = 'active', promoted_at = now(),
               name = coalesce(${name ?? null}, name),
               description = coalesce(${description ?? null}, description)
        where id = ${src.id}`
      await log({ action: 'promote' })
      return { ok: true as const }
    }

    if (body.action === 'merge') {
      if (body.intoSlug === slug) throw new HttpError(400, 'cannot merge a topic into itself')
      const [dst] = await tx<{ id: string; kind: string; status: string }[]>`
        select id, kind, status from topics where slug = ${body.intoSlug} for update`
      if (!dst) throw new HttpError(404, 'unknown target topic')
      if (dst.kind !== 'seed' || dst.status === 'dismissed') {
        throw new HttpError(409, 'target must be an existing seed topic')
      }
      const moved = await tx`
        update classifications set topic_id = ${dst.id} where topic_id = ${src.id}`
      await tx`
        update topics set status = 'dismissed', merged_into_id = ${dst.id} where id = ${src.id}`
      await log({ action: 'merge', intoSlug: body.intoSlug, movedClassifications: moved.count })
      return { ok: true as const, movedClassifications: moved.count }
    }

    await tx`update topics set status = 'dismissed' where id = ${src.id}`
    await log({ action: 'dismiss' })
    return { ok: true as const }
  })
}

const SECRET_KEY = /token|secret|password|creds/i

export function redactDetail(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redactDetail)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).map(([k, val]) => [
        k,
        SECRET_KEY.test(k) ? '[redacted]' : redactDetail(val),
      ]),
    )
  }
  return v
}

export const AUDIT_KINDS = [
  'login',
  'login_failed',
  'view',
  'relabel',
  'config_change',
  'promote_topic',
]
const PAGE = 50
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})\|(\d{1,18})$/

export function parseAuditCursor(c: string | null): { at: string; id: string } | null {
  if (!c) return null
  const m = CURSOR.exec(c)
  if (!m) throw new HttpError(400, 'bad cursor')
  return { at: m[1]!, id: m[2]! }
}

export async function listAudit(sql: Sql, cursor: string | null): Promise<AuditResponse> {
  const cur = parseAuditCursor(cursor)
  const rows = await sql<
    {
      id: string
      at_key: string
      ms: number
      kind: string
      ip: string | null
      detail: Record<string, unknown>
    }[]
  >`
    select id::text, to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as at_key,
           extract(epoch from at) * 1000 as ms, kind, ip, detail
    from event_log
    where kind = any(${AUDIT_KINDS})
      and (${cur === null}::boolean
           or (at, id) < ((${cur?.at ?? '1970-01-01T00:00:00.000000'}::timestamp at time zone 'UTC'),
                          ${cur?.id ?? '0'}::bigint))
    order by at desc, id desc
    limit ${PAGE + 1}`
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  const items: AuditItem[] = page.map((r) => ({
    at: msToIso(r.ms) ?? '',
    kind: r.kind,
    ip: r.ip,
    detail: redactDetail(r.detail) as Record<string, unknown>,
  }))
  return {
    items,
    nextCursor: rows.length > PAGE && last ? `${last.at_key}|${last.id}` : null,
  }
}
