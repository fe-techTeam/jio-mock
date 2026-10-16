// v0.1 data model (brew spec Data section + CONTRACTS.md "Database"). JS keys are camelCase,
// columns snake_case, every timestamp is timestamptz. Text enums carry the @jio/core unions.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  pgView,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import type {
  AppConfig,
  AuthorKind,
  ClassificationOrigin,
  Confidence,
  EntityFilter,
  EntityKey,
  EventKind,
  FetchRunStatus,
  Lang,
  Lane,
  LaneFilter,
  MarketSeries,
  Sentiment,
  SourceKey,
  TopicKind,
  TopicStatus,
} from '@jio/core'

const tstz = (name: string) => timestamp(name, { withTimezone: true })

export const authors = pgTable(
  'authors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    platform: text('platform').notNull(),
    platformUserId: text('platform_user_id').notNull(),
    handle: text('handle'),
    displayName: text('display_name'),
    followers: integer('followers'),
    kind: text('kind').$type<AuthorKind>().notNull().default('other'),
    firstSeenAt: tstz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: tstz('last_seen_at').notNull().defaultNow(),
    deleteAfter: tstz('delete_after').notNull(),
  },
  (t) => [unique('authors_platform_user_uq').on(t.platform, t.platformUserId)],
)

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceKey: text('source_key').$type<SourceKey>().notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    authorId: uuid('author_id').references(() => authors.id, { onDelete: 'set null' }),
    lane: text('lane').$type<Lane>().notNull(),
    text: text('text').notNull(),
    /** NULL means not yet triaged (03-01). */
    lang: text('lang').$type<Lang>(),
    publishedAt: tstz('published_at').notNull(),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
    reachRaw: jsonb('reach_raw').$type<Record<string, number>>().notNull().default({}),
    reachScore: real('reach_score'),
    contentHash: text('content_hash'),
    embedding: vector('embedding', { dimensions: 1024 }),
    nearDupClusterId: text('near_dup_cluster_id'),
    matchedTerms: text('matched_terms').array().notNull().default([]),
    rawJson: jsonb('raw_json'),
    isFixture: boolean('is_fixture').notNull().default(false),
  },
  (t) => [
    unique('posts_source_external_uq').on(t.sourceKey, t.externalId),
    index('posts_published_at_idx').on(t.publishedAt),
    index('posts_lane_published_at_idx').on(t.lane, t.publishedAt),
    index('posts_content_hash_idx').on(t.contentHash),
    index('posts_author_id_idx').on(t.authorId),
    index('posts_near_dup_cluster_idx').on(t.nearDupClusterId),
    index('posts_untriaged_idx')
      .on(t.fetchedAt)
      .where(sql`lang is null`),
    index('posts_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
  ],
)

export const topics = pgTable('topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique('topics_slug_uq'),
  name: text('name').notNull(),
  kind: text('kind').$type<TopicKind>().notNull(),
  description: text('description').notNull().default(''),
  examplePhrases: text('example_phrases').array().notNull().default([]),
  summary2line: text('summary_2line'),
  summaryAt: tstz('summary_at'),
  status: text('status').$type<TopicStatus>().notNull().default('active'),
  promotedAt: tstz('promoted_at'),
  mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => topics.id, {
    onDelete: 'set null',
  }),
  createdAt: tstz('created_at').notNull().defaultNow(),
})

const classificationColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id')
    .notNull()
    .references(() => posts.id, { onDelete: 'cascade' }),
  origin: text('origin').$type<ClassificationOrigin>().notNull(),
  topicId: uuid('topic_id')
    .notNull()
    .references(() => topics.id, { onDelete: 'restrict' }),
  sentiment: text('sentiment').$type<Sentiment>().notNull(),
  entities: text('entities').array().$type<EntityKey[]>().notNull().default([]),
  confidence: text('confidence').$type<Confidence>().notNull(),
  glossEn: text('gloss_en'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  /** Who relabelled (correction/gold); null for model rows. */
  actor: text('actor'),
  createdAt: tstz('created_at').notNull().defaultNow(),
}

export const classifications = pgTable('classifications', classificationColumns, (t) => [
  index('classifications_post_created_idx').on(t.postId, t.createdAt),
  index('classifications_origin_created_idx').on(t.origin, t.createdAt),
  index('classifications_topic_idx').on(t.topicId),
])

export const topicStats15m = pgTable(
  'topic_stats_15m',
  {
    bucketStart: tstz('bucket_start').notNull(),
    topicId: uuid('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    entity: text('entity').$type<EntityFilter>().notNull(),
    lane: text('lane').$type<LaneFilter>().notNull(),
    items: integer('items').notNull().default(0),
    pos: integer('pos').notNull().default(0),
    neu: integer('neu').notNull().default(0),
    neg: integer('neg').notNull().default(0),
    lowConf: integer('low_conf').notNull().default(0),
    reachPos: real('reach_pos').notNull().default(0),
    reachNeu: real('reach_neu').notNull().default(0),
    reachNeg: real('reach_neg').notNull().default(0),
    suspectedCoordinated: integer('suspected_coordinated').notNull().default(0),
    burstFlag: boolean('burst_flag').notNull().default(false),
    top5AuthorShare: real('top5_author_share'),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'topic_stats_15m_pk',
      columns: [t.bucketStart, t.topicId, t.entity, t.lane],
    }),
    index('topic_stats_15m_topic_bucket_idx').on(t.topicId, t.bucketStart),
  ],
)

export const marketPoints = pgTable(
  'market_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    series: text('series').$type<MarketSeries>().notNull(),
    value: doublePrecision('value').notNull(),
    observedAt: tstz('observed_at').notNull(),
    sourceKey: text('source_key').$type<SourceKey>().notNull(),
    sourceUrl: text('source_url').notNull(),
    fetchedAt: tstz('fetched_at').notNull().defaultNow(),
  },
  (t) => [
    unique('market_points_series_source_observed_uq').on(t.series, t.sourceKey, t.observedAt),
    index('market_points_series_observed_idx').on(t.series, t.observedAt),
  ],
)

export const configVersions = pgTable('config_versions', {
  /** latest + 1, written under an advisory lock, so versions are contiguous. */
  version: integer('version').primaryKey(),
  savedAt: tstz('saved_at').notNull().defaultNow(),
  actor: text('actor').notNull(),
  /** The whole AppConfig; new keys need no migration. */
  config: jsonb('config').$type<AppConfig>().notNull(),
})

export const eventLog = pgTable(
  'event_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz('at').notNull().defaultNow(),
    kind: text('kind').$type<EventKind>().notNull(),
    sourceKey: text('source_key').$type<SourceKey>(),
    status: text('status').$type<FetchRunStatus>(),
    itemsNew: integer('items_new'),
    costUsd: doublePrecision('cost_usd'),
    durationMs: integer('duration_ms'),
    error: text('error'),
    ip: text('ip'),
    /** Lowercased email for login kinds; the saving user for config_change. */
    actor: text('actor'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('event_log_kind_at_idx').on(t.kind, t.at),
    index('event_log_source_kind_at_idx').on(t.sourceKey, t.kind, t.at),
    index('event_log_actor_kind_at_idx').on(t.actor, t.kind, t.at),
  ],
)

/**
 * One row per classified post: the latest correction or gold row, else the latest model row.
 * Created in migration 0001 (SELECT DISTINCT ON over classifications); drizzle-kit ignores it.
 */
export const effectiveClassifications = pgView('effective_classifications', {
  id: uuid('id').notNull(),
  postId: uuid('post_id').notNull(),
  origin: text('origin').$type<ClassificationOrigin>().notNull(),
  topicId: uuid('topic_id').notNull(),
  sentiment: text('sentiment').$type<Sentiment>().notNull(),
  entities: text('entities').array().$type<EntityKey[]>().notNull(),
  confidence: text('confidence').$type<Confidence>().notNull(),
  glossEn: text('gloss_en'),
  model: text('model'),
  promptVersion: text('prompt_version'),
  actor: text('actor'),
  createdAt: tstz('created_at').notNull(),
}).existing()

export * from './auth-schema'
