// Trust-layer thresholds (06-01 reach, 06-02 coordination). They live in worker code, not in the
// core AppConfig schema: an optional `trust` block in the stored config is deep-merged over
// TRUST_DEFAULTS, and anything that fails to parse falls back to the defaults.
import { SOURCE_KEYS } from '@jio/core'
import { z } from 'zod'

const unit = z.number().min(0).max(1)

export const ReachConfig = z
  .object({
    /** Percentile of log10(1 + metric) per source that maps to a score of 1. */
    percentile: z.number().gt(0).max(1),
    lookbackDays: z.number().int().min(1).max(90),
    mediaOutletWeight: unit,
    floor: unit,
    unknownScore: unit,
    minSamplesForPercentile: z.number().int().min(1),
    /** Fallback p95 of log10(1 + metric) per source when there are too few samples. */
    defaultP95Log: z.record(z.enum(SOURCE_KEYS), z.number().positive()),
    fullRescoreEveryMin: z.number().int().min(1),
  })
  .strict()
export type ReachConfig = z.infer<typeof ReachConfig>

export const CoordinationConfig = z
  .object({
    nearDupMinAuthors: z.number().int().min(2),
    nearDupWindowMin: z.number().int().min(1),
    burstMultiplier: z.number().positive(),
    burstMinItems: z.number().int().min(1),
    top5ShareThreshold: unit,
    top5MinItems: z.number().int().min(1),
  })
  .strict()
export type CoordinationConfig = z.infer<typeof CoordinationConfig>

export const TrustConfig = z
  .object({ reach: ReachConfig, coordination: CoordinationConfig })
  .strict()
export type TrustConfig = z.infer<typeof TrustConfig>

export const TRUST_DEFAULTS: TrustConfig = {
  reach: {
    percentile: 0.95,
    lookbackDays: 7,
    mediaOutletWeight: 0.6,
    floor: 0.05,
    unknownScore: 0.25,
    minSamplesForPercentile: 20,
    defaultP95Log: {
      x_api: 5,
      x_apify: 5,
      apify_linkedin: 4,
      apify_instagram: 4,
      youtube: 5,
      reddit: 3,
    },
    fullRescoreEveryMin: 60,
  },
  coordination: {
    nearDupMinAuthors: 5,
    nearDupWindowMin: 60,
    burstMultiplier: 4,
    burstMinItems: 10,
    top5ShareThreshold: 0.4,
    top5MinItems: 30,
  },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Recursively merges plain objects; any other override value replaces the base value. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined) return structuredClone(base)
  if (!isPlainObject(base) || !isPlainObject(override)) return structuredClone(override)
  const out: Record<string, unknown> = structuredClone(base)
  for (const [k, v] of Object.entries(override)) out[k] = deepMerge(base[k], v)
  return out
}

/**
 * The trust thresholds for a stored config: `appConfig.trust` (optional, partial) deep-merged over
 * TRUST_DEFAULTS. A merged value that fails validation returns a fresh copy of the defaults.
 */
export function resolveTrustConfig(appConfig: unknown): TrustConfig {
  const trust = isPlainObject(appConfig) ? appConfig.trust : undefined
  const parsed = TrustConfig.safeParse(deepMerge(TRUST_DEFAULTS, trust))
  return parsed.success ? parsed.data : structuredClone(TRUST_DEFAULTS)
}
