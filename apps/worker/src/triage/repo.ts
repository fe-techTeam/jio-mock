// SQL for the triage pass, over the postgres-js client returned by createDb.
//
// Markers (posts has no relevance flag): lang IS NULL = untriaged; matched_terms = '{}' with
// embedding IS NULL after triage = dropped as irrelevant.
import type { Lang } from '@jio/core'
import type { createDb } from '@jio/db'
import type { DbNeighbor } from './near-dup'
import { NEIGHBOR_WINDOW_HOURS } from './near-dup'
import { toPgVector } from './vector'

export type UntriagedPost = { id: string; text: string; publishedAt: Date }

export type TriageRow = {
  id: string
  lang: Lang
  contentHash: string
  matchedTerms: string[]
  /** null for dropped posts, failed embeddings and all-zero vectors. */
  embedding: number[] | null
  nearDupClusterId: string | null
}

/** The postgres-js client from createDb (the worker does not depend on `postgres` directly). */
export type Sql = ReturnType<typeof createDb>['sql']

const WRITE_CHUNK = 200

export async function selectUntriaged(sql: Sql, limit: number): Promise<UntriagedPost[]> {
  // drizzle's postgres-js driver leaves timestamps as strings, so parse here.
  const rows = await sql<{ id: string; text: string; published_at: string | Date }[]>`
    select id, text, published_at
    from posts
    where lang is null
    order by fetched_at, id
    limit ${limit}`
  return rows.map((r) => ({ id: r.id, text: r.text, publishedAt: new Date(r.published_at) }))
}

/** The k most similar embedded posts within +-48h of publishedAt (similarity = 1 - cosine distance). */
export async function findNeighbors(
  sql: Sql,
  vector: number[],
  publishedAt: Date,
  excludeIds: readonly string[],
  k = 5,
): Promise<DbNeighbor[]> {
  const windowMs = NEIGHBOR_WINDOW_HOURS * 3_600_000
  const from = new Date(publishedAt.getTime() - windowMs).toISOString()
  const to = new Date(publishedAt.getTime() + windowMs).toISOString()
  const v = toPgVector(vector)
  const rows = await sql<{ id: string; near_dup_cluster_id: string | null; similarity: number }[]>`
    select id, near_dup_cluster_id, 1 - (embedding <=> ${v}::vector) as similarity
    from posts
    where embedding is not null
      and published_at between ${from}::timestamptz and ${to}::timestamptz
      and not (id = any(${sql.array(excludeIds as string[])}::uuid[]))
    order by embedding <=> ${v}::vector
    limit ${k}`
  return rows.map((r) => ({
    id: r.id,
    clusterId: r.near_dup_cluster_id,
    similarity: Number(r.similarity),
  }))
}

/**
 * Writes triage results in transactions of 200 rows. Only still-untriaged rows are updated, so a
 * concurrent pass cannot overwrite them. Neighbor updates only fill an empty cluster id.
 */
export async function writeTriage(
  sql: Sql,
  rows: readonly TriageRow[],
  neighborUpdates: readonly { id: string; clusterId: string }[] = [],
): Promise<void> {
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK)
    await sql.begin(async (tx) => {
      for (const r of chunk) {
        const emb = r.embedding ? toPgVector(r.embedding) : null
        await tx`
          update posts
          set lang = ${r.lang},
              content_hash = ${r.contentHash},
              matched_terms = ${tx.array(r.matchedTerms)}::text[],
              embedding = ${emb}::vector,
              near_dup_cluster_id = ${r.nearDupClusterId}
          where id = ${r.id} and lang is null`
      }
    })
  }
  if (neighborUpdates.length > 0) {
    await sql.begin(async (tx) => {
      for (const u of neighborUpdates) {
        await tx`
          update posts set near_dup_cluster_id = ${u.clusterId}
          where id = ${u.id} and near_dup_cluster_id is null`
      }
    })
  }
}
