import { and, asc, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { SEED_TOPICS, type TopicDef, type TopicKind, type TopicStatus } from '@jio/core'
import { topics } from '../schema'
import type { DbLike } from './events'

export type StoredTopicDef = TopicDef & { id: string; status: TopicStatus }

/** Inserts topics on conflict (slug) do nothing, so edits survive reseeding. Returns inserted count. */
export async function upsertSeedTopics(
  db: DbLike,
  defs: TopicDef[] = SEED_TOPICS,
): Promise<number> {
  if (defs.length === 0) return 0
  const inserted = await db
    .insert(topics)
    .values(
      defs.map((t) => ({
        slug: t.slug,
        name: t.name,
        kind: t.kind,
        description: t.description,
        examplePhrases: t.examplePhrases,
      })),
    )
    .onConflictDoNothing({ target: topics.slug })
    .returning({ id: topics.id })
  return inserted.length
}

/** Topic definitions for the classifier and UI; dismissed topics are excluded. */
export async function listTopicDefs(
  db: DbLike,
  opts: { kinds?: TopicKind[] } = {},
): Promise<StoredTopicDef[]> {
  const where: SQL[] = [ne(topics.status, 'dismissed')]
  if (opts.kinds) where.push(inArray(topics.kind, opts.kinds))
  return db
    .select({
      id: topics.id,
      slug: topics.slug,
      name: topics.name,
      kind: topics.kind,
      description: topics.description,
      examplePhrases: topics.examplePhrases,
      status: topics.status,
    })
    .from(topics)
    .where(and(...where))
    .orderBy(sql`(${topics.kind} = 'seed') desc`, asc(topics.createdAt), asc(topics.slug))
}
