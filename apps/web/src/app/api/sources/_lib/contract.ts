// Shared by the /api/sources routes and the Sources page (browser-safe: types and zod only).
// Lives here rather than in @jio/core api-types.ts, which 04-01 owns.
import { z } from 'zod'
import type { Lane, SourceKey, XTier } from '@jio/core'

export const SOURCE_ORDER = [
  'x_api',
  'x_apify',
  'reddit',
  'news_rss',
  'web_search',
  'youtube',
  'apify_instagram',
  'apify_linkedin',
  'portal_chittorgarh',
  'portal_investorgain',
  'portal_ipowatch',
] as const satisfies readonly SourceKey[]

export const SOURCE_NAMES: Record<SourceKey, string> = {
  x_api: 'X (official API)',
  x_apify: 'X (Apify fallback)',
  reddit: 'Reddit',
  news_rss: 'News RSS',
  web_search: 'Web search',
  youtube: 'YouTube',
  apify_instagram: 'Instagram (Apify)',
  apify_linkedin: 'LinkedIn (Apify)',
  portal_chittorgarh: 'Chittorgarh',
  portal_investorgain: 'Investorgain',
  portal_ipowatch: 'IPO Watch',
}

export const YOUTUBE_DAILY_QUOTA = 10_000

export type SourceStatus = 'ok' | 'stale' | 'circuit_open' | 'waiting' | 'disabled'
export type SourceMode = 'live' | 'fixture'

export type SourceRow = {
  key: SourceKey
  name: string
  lane: Lane
  enabled: boolean
  status: SourceStatus
  mode: SourceMode
  missingCreds: string[]
  coverageLabel: string
  intervalMin: number
  marketHoursIntervalMin: number | null
  effectiveIntervalMin: number
  lastSuccessAt: string | null
  lastErrorAt: string | null
  lastError: string | null
  nextRunAt: string | null
  consecutiveFailures: number
  items24h: number
  spendTodayUsd: number
}

export type XCard = {
  tier: XTier | null
  rateLimits: Record<string, number>
  credsSet: boolean
  modeLabel: 'Official API' | 'Apify fallback'
}

export type QuotaCard = {
  unitsUsedToday: number | null
  limit: number
  resetsAt: string
}

export type SourcesResponse = {
  asOf: string
  configVersion: number
  oldestSuccessAgeMin: number | null
  spendTodayUsd: number
  spend7dUsd: number
  sources: SourceRow[]
  x: XCard
  youtubeQuota: QuotaCard
}

export type RunRow = {
  at: string
  status: string | null
  durationMs: number | null
  itemsNew: number | null
  costUsd: number | null
  error: string | null
}

const int = z.number()

export const SourcePatch = z
  .object({
    enabled: z.boolean().optional(),
    interval_min: int.optional(),
    market_hours_interval_min: int.optional(),
  })
  .strict()

export const SourcesPatch = z
  .object({
    baseVersion: z.number().int().min(0),
    sources: z.record(z.string(), SourcePatch).optional(),
    x: z
      .object({
        x_tier: z.string().nullable().optional(),
        rate_limits: z.record(z.string(), z.number()).optional(),
        bearerToken: z.string().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type SourcesPatch = z.infer<typeof SourcesPatch>

export type FieldIssue = { path: (string | number)[]; code: string; message: string }
export type ApiFieldErrors = { error: string; issues?: FieldIssue[] }
