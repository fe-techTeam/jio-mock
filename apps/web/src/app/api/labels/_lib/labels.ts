// Label writes and the gold queue. All SQL uses postgres-js tagged templates (parameters only).
// The shared client does not parse timestamps, so times cross the boundary as epoch ms.
import type { EntityKey, Lang, Sentiment } from '@jio/core'
import type { Sql } from 'postgres'
import {
  GOLD_LANGS,
  GOLD_PER_LANG,
  GOLD_TARGET,
  UNDO_WINDOW_MS,
  type GoldProgress,
  type LabelRequest,
  type QueueItem,
} from './contract'

type Label = { sentiment: Sentiment; topicSlug: string; entities: EntityKey[] }

export type CreateResult =
  | { kind: 'ok'; classificationId: string }
  | { kind: 'not_found' }
  | { kind: 'bad_topic' }
  | { kind: 'gold_complete' }

export type UndoResult = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'not_undoable' }

const GOLD_LOCK = 52_050_300

export async function createLabel(
  sql: Sql,
  input: LabelRequest,
  actor: string,
): Promise<CreateResult> {
  return sql.begin(async (tx): Promise<CreateResult> => {
    if (input.origin === 'gold') {
      // Serialise gold writes so two requests cannot both take the 200th slot.
      await tx`select pg_advisory_xact_lock(${GOLD_LOCK})`
    }
    const [target] = await tx<{ id: string }[]>`select id from posts where id = ${input.postId}`
    if (!target) return { kind: 'not_found' }
    const [topic] = await tx<{ id: string }[]>`
      select id from topics where slug = ${input.topicSlug} and status <> 'dismissed'`
    if (!topic) return { kind: 'bad_topic' }

    if (input.origin === 'gold') {
      const [c] = await tx<{ total: number; mine: number }[]>`
        select count(distinct post_id)::int as total,
               count(distinct post_id) filter (where post_id = ${input.postId})::int as mine
        from classifications where origin = 'gold'`
      if (c && c.total >= GOLD_TARGET && c.mine === 0) return { kind: 'gold_complete' }
    }

    const [prev] = await tx<{ sentiment: Sentiment; slug: string; entities: EntityKey[] | null }[]>`
      select e.sentiment, t.slug, e.entities
      from effective_classifications e join topics t on t.id = e.topic_id
      where e.post_id = ${input.postId}`
    const [gloss] = await tx<{ gloss_en: string | null }[]>`
      select gloss_en from classifications
      where post_id = ${input.postId} and origin = 'model'
      order by created_at desc, id desc limit 1`

    const [row] = await tx<{ id: string }[]>`
      insert into classifications (post_id, origin, topic_id, sentiment, entities, confidence,
                                   gloss_en, model, prompt_version, actor)
      values (${input.postId}, ${input.origin}, ${topic.id}, ${input.sentiment},
              ${input.entities as string[]}::text[], 'high', ${gloss?.gloss_en ?? null},
              null, null, ${actor})
      returning id`
    const classificationId = row!.id
    const from: Label | null = prev
      ? { sentiment: prev.sentiment, topicSlug: prev.slug, entities: prev.entities ?? [] }
      : null
    const to: Label = {
      sentiment: input.sentiment,
      topicSlug: input.topicSlug,
      entities: input.entities,
    }
    const detail = {
      postId: input.postId,
      origin: input.origin,
      classificationId,
      from,
      to,
      sarcastic: input.sarcastic ?? false,
    }
    await tx`insert into event_log (kind, actor, detail)
             values ('relabel', ${actor}, ${JSON.stringify(detail)}::jsonb)`
    return { kind: 'ok', classificationId }
  })
}

export async function undoLabel(sql: Sql, id: string, actor: string): Promise<UndoResult> {
  return sql.begin(async (tx): Promise<UndoResult> => {
    const [row] = await tx<{ post_id: string; origin: string; age_ms: number }[]>`
      select post_id, origin, extract(epoch from (now() - created_at)) * 1000 as age_ms
      from classifications where id = ${id} for update`
    if (!row) return { kind: 'not_found' }
    if (row.origin === 'model' || Number(row.age_ms) > UNDO_WINDOW_MS) {
      return { kind: 'not_undoable' }
    }
    await tx`delete from classifications where id = ${id}`
    const detail = { undo: true, classificationId: id, postId: row.post_id }
    await tx`insert into event_log (kind, actor, detail)
             values ('relabel', ${actor}, ${JSON.stringify(detail)}::jsonb)`
    return { kind: 'ok' }
  })
}

export async function goldProgress(sql: Sql): Promise<GoldProgress> {
  const rows = await sql<{ lang: Lang | null; n: number }[]>`
    select p.lang, count(distinct g.post_id)::int as n
    from classifications g join posts p on p.id = g.post_id
    where g.origin = 'gold'
    group by p.lang`
  const byLang: Record<Lang, number> = { en: 0, hinglish: 0, hi: 0, gu: 0, other: 0 }
  let labelled = 0
  for (const r of rows) {
    labelled += r.n
    if (r.lang) byLang[r.lang] += r.n
  }
  return { labelled, target: GOLD_TARGET, byLang }
}

type QueueRow = {
  id: string
  text: string
  lang: Lang
  gloss_en: string | null
  source_key: string
  published_ms: number
  url: string
}

/**
 * The next post to gold-label. Blind: only post fields, never the model's label. Fixture posts
 * are excluded. The language with the fewest gold labels among those that still have candidates
 * (under the 50 per language target) goes first; within it, md5(id) gives a stable spread.
 */
export async function nextQueueItem(
  sql: Sql,
  exclude: string[],
): Promise<{ item: QueueItem | null; progress: GoldProgress }> {
  const progress = await goldProgress(sql)
  if (progress.labelled >= GOLD_TARGET) return { item: null, progress }

  const counts = await sql<{ lang: Lang; n: number }[]>`
    select p.lang, count(*)::int as n
    from posts p
    where p.is_fixture = false
      and p.lang in ${sql(GOLD_LANGS)}
      and exists (select 1 from classifications m where m.post_id = p.id and m.origin = 'model')
      and not exists (select 1 from classifications g where g.post_id = p.id and g.origin = 'gold')
      and p.id <> all(${exclude}::uuid[])
    group by p.lang`
  const open = counts.map((c) => c.lang)
  if (open.length === 0) return { item: null, progress }
  // Prefer languages under their target; once all are met, any language with candidates.
  const under = open.filter((l) => progress.byLang[l] < GOLD_PER_LANG)
  const pool = under.length > 0 ? under : open
  const lang = pool.reduce((a, b) => (progress.byLang[b] < progress.byLang[a] ? b : a))

  const [row] = await sql<QueueRow[]>`
    select p.id, p.text, p.lang,
           (select c.gloss_en from classifications c
             where c.post_id = p.id and c.origin = 'model'
             order by c.created_at desc, c.id desc limit 1) as gloss_en,
           p.source_key, extract(epoch from p.published_at) * 1000 as published_ms, p.url
    from posts p
    where p.is_fixture = false
      and p.lang = ${lang}
      and exists (select 1 from classifications m where m.post_id = p.id and m.origin = 'model')
      and not exists (select 1 from classifications g where g.post_id = p.id and g.origin = 'gold')
      and p.id <> all(${exclude}::uuid[])
    order by md5(p.id::text)
    limit 1`
  if (!row) return { item: null, progress }
  return {
    item: {
      postId: row.id,
      text: row.text,
      lang: row.lang,
      glossEn: row.lang === 'en' ? null : row.gloss_en,
      sourceKey: row.source_key,
      publishedAt: new Date(Number(row.published_ms)).toISOString(),
      url: row.url,
    },
    progress,
  }
}
