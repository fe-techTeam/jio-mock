// Versioned app config (brew Data > Config). JSON keys are snake_case; every field that is not a
// term list has a default so old config_versions rows keep parsing as the schema grows.
import { z } from 'zod'
import { COVERAGE_LABELS, LANES, SOURCE_KEYS, X_TIERS, type SourceKey } from './types'

export const TermList = z.array(z.string().trim().min(1).max(100))

const EntityConfig = z.object({
  label: z.string().trim().min(1),
  aliases: TermList.min(1),
})

/**
 * Keyword lists. Strong lists (ipo_terms, hashtags, entity aliases) match alone. anchor_groups are
 * ambiguous words ('jio' means 'live' in Hindi) that need a qualifier (cooccurrence_terms or
 * generic_hashtags) or an anchor from a second group. negative_terms are masked out first.
 */
export const TermsConfig = z.object({
  ipo_terms: TermList,
  hashtags: TermList,
  generic_hashtags: TermList,
  entities: z.object({
    mukesh: EntityConfig,
    akash: EntityConfig,
    isha: EntityConfig,
    jio: EntityConfig,
  }),
  anchor_groups: z.array(z.object({ name: z.string().trim().min(1), terms: TermList.min(1) })),
  cooccurrence_terms: TermList,
  negative_terms: TermList,
})
export type TermsConfig = z.infer<typeof TermsConfig>

const IntervalMin = z.number().int().min(1).max(1440)

export const SourceConfig = z.object({
  enabled: z.boolean().default(true),
  lane: z.enum(LANES),
  interval_min: IntervalMin,
  market_hours_interval_min: IntervalMin.nullable().default(null),
  coverage_label: z.enum(COVERAGE_LABELS).default('full_search'),
  x_tier: z.enum(X_TIERS).nullable().default(null),
  rate_limits: z.record(z.string(), z.number()).default({}),
  /**
   * Credentials saved from the Sources page: env-style name (e.g. X_BEARER_TOKEN) to an encrypted
   * `enc:v1:` blob. Never returned by an API.
   */
  creds_ref: z.record(z.string(), z.string()).nullable().default(null),
  params: z.record(z.string(), z.unknown()).default({}),
})
export type SourceConfig = z.infer<typeof SourceConfig>

const sourcesShape = Object.fromEntries(SOURCE_KEYS.map((k) => [k, SourceConfig])) as Record<
  SourceKey,
  typeof SourceConfig
>

export const AppConfig = z.object({
  terms: TermsConfig,
  sources: z.object(sourcesShape),
  retention_days: z
    .object({
      raw_json: z.number().int().min(1).default(30),
      post_text: z.number().int().min(1).default(90),
      authors: z.number().int().min(1).default(90),
    })
    .refine((r) => r.raw_json <= r.post_text, {
      message: 'raw_json retention cannot exceed post_text retention',
      path: ['raw_json'],
    })
    .default({}),
  min_items_for_split: z.number().int().min(1).default(30),
  active_min_items_24h: z.number().int().min(1).default(10),
  backfill_days: z.number().int().min(0).max(30).default(7),
  /** Locked off until counsel decides; cannot be set true. */
  person_level_views: z.literal(false).default(false),
})
export type AppConfig = z.infer<typeof AppConfig>
/** Input shape (defaults optional), e.g. an old config_versions row. */
export type AppConfigInput = z.input<typeof AppConfig>
