// SQL helpers for the classify-batch step. Uses the postgres-js client from createDb; the drizzle
// driver leaves timestamps as strings, so dates go in as ISO strings with explicit casts.
import type { Confidence, EntityKey, Lang, Sentiment, TopicDef } from '@jio/core'
import { listTopicDefs } from '@jio/db'
import type { Db } from '@jio/db'
import type { CachedLabel, ClassificationCache } from '../classify/batch'
import type { FewShotExample } from '../classify/classifier'
import type { Sql } from '../triage/repo'

type H = { db: Db; sql: Sql }

/**
 * The `limit` most recent analyst corrections (one per post, its latest), with the post text, as
 * few-shot examples for the classifier prompt.
 */
export async function loadFewShot(h: { sql: Sql }, limit = 20): Promise<FewShotExample[]> {
  const rows = await h.sql<
    {
      text: string
      lang: Lang | null
      slug: string
      sentiment: Sentiment
      entities: EntityKey[]
    }[]
  >`
    select text, lang, slug, sentiment, entities from (
      select distinct on (c.post_id) p.text, p.lang, t.slug, c.sentiment, c.entities,
             c.created_at, c.id
      from classifications c
      join posts p on p.id = c.post_id
      join topics t on t.id = c.topic_id
      where c.origin = 'correction'
      order by c.post_id, c.created_at desc, c.id desc
    ) latest
    order by created_at desc, id desc
    limit ${limit}`
  return rows.map((r) => ({
    text: r.text,
    lang: r.lang ?? 'other',
    topicSlug: r.slug,
    sentiment: r.sentiment,
    entities: [...r.entities],
  }))
}

export type CacheSource = { model: string | null; promptVersion: string | null }

/** ClassificationCache over stored labels; `sources` records where each hit came from. */
export type DbClassificationCache = ClassificationCache & {
  readonly sources: Map<string, CacheSource>
}

/**
 * For each content hash, the effective label of the newest (by published_at) already-classified
 * post with that hash. Pending posts have no classification, so they never match themselves.
 */
export function dbClassificationCache(h: { sql: Sql }): DbClassificationCache {
  const sources = new Map<string, CacheSource>()
  return {
    sources,
    async get(hashes: string[]): Promise<Map<string, CachedLabel>> {
      const out = new Map<string, CachedLabel>()
      if (hashes.length === 0) return out
      const rows = await h.sql<
        {
          content_hash: string
          slug: string
          sentiment: Sentiment
          entities: EntityKey[]
          confidence: Confidence
          gloss_en: string | null
          model: string | null
          prompt_version: string | null
        }[]
      >`
        select distinct on (p.content_hash)
               p.content_hash, t.slug, ec.sentiment, ec.entities, ec.confidence, ec.gloss_en,
               ec.model, ec.prompt_version
        from posts p
        join effective_classifications ec on ec.post_id = p.id
        join topics t on t.id = ec.topic_id
        where p.content_hash = any(${h.sql.array(hashes)}::text[])
        order by p.content_hash, p.published_at desc, p.id desc`
      for (const r of rows) {
        out.set(r.content_hash, {
          topicSlug: r.slug,
          sentiment: r.sentiment,
          entities: [...r.entities],
          confidence: r.confidence,
          glossEn: r.gloss_en,
        })
        sources.set(r.content_hash, { model: r.model, promptVersion: r.prompt_version })
      }
      return out
    },
  }
}

export type PendingPost = {
  postId: string
  text: string
  lang: Lang
  contentHash: string
  matchedTerms: string[]
}

/** Triaged, relevant posts with no classification row yet, newest published first. */
export async function pendingPosts(h: { sql: Sql }, limit: number): Promise<PendingPost[]> {
  const rows = await h.sql<
    {
      id: string
      text: string
      lang: Lang
      content_hash: string | null
      matched_terms: string[]
    }[]
  >`
    select p.id, p.text, p.lang, p.content_hash, p.matched_terms
    from posts p
    where p.lang is not null
      and cardinality(p.matched_terms) > 0
      and not exists (select 1 from classifications c where c.post_id = p.id)
    order by p.published_at desc, p.id
    limit ${limit}`
  return rows.map((r) => ({
    postId: r.id,
    text: r.text,
    lang: r.lang,
    // Triage always sets content_hash; fall back to a per-post key so nothing is shared by accident.
    contentHash: r.content_hash ?? `post:${r.id}`,
    matchedTerms: [...r.matched_terms],
  }))
}

/** Seeded, non-dismissed topics as classifier TopicDefs. */
export async function loadClassifierTopics(h: H): Promise<TopicDef[]> {
  const rows = await listTopicDefs(h.db, { kinds: ['seed'] })
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    description: r.description,
    examplePhrases: r.examplePhrases,
  }))
}

/** slug -> id for every non-dismissed topic. */
export async function topicIdsBySlug(h: { sql: Sql }): Promise<Map<string, string>> {
  const rows = await h.sql<{ id: string; slug: string }[]>`
    select id, slug from topics where status <> 'dismissed'`
  return new Map(rows.map((r) => [r.slug, r.id]))
}
