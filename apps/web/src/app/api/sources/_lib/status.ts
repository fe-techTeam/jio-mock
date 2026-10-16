// Pure source-status logic: effective cadence, status derivation, mode and credential needs.
import { isIndianMarketHours, type SourceKey } from '@jio/core'
import type { SourceMode, SourceStatus } from './contract'
import { YOUTUBE_DAILY_QUOTA } from './contract'

/** Matches the worker breaker threshold (SUMMARY-02-01: threshold 3). */
export const BREAKER_THRESHOLD = 3
/** YouTube search.list costs 100 units. */
export const YOUTUBE_SEARCH_UNITS = 100

const isPortal = (key: SourceKey) => key.startsWith('portal_')

export function effectiveIntervalMin(
  key: SourceKey,
  src: { interval_min: number; market_hours_interval_min: number | null },
  now: Date,
): number {
  if (isPortal(key) && src.market_hours_interval_min != null && isIndianMarketHours(now)) {
    return src.market_hours_interval_min
  }
  return src.interval_min
}

export function deriveStatus(i: {
  enabled: boolean
  lastRunAt: Date | null
  lastSuccessAt: Date | null
  consecutiveFailures: number
  effectiveIntervalMin: number
  now: Date
  breakerThreshold?: number
}): SourceStatus {
  if (!i.enabled) return 'disabled'
  if (!i.lastRunAt) return 'waiting'
  if (i.consecutiveFailures >= (i.breakerThreshold ?? BREAKER_THRESHOLD)) return 'circuit_open'
  if (
    !i.lastSuccessAt ||
    i.now.getTime() - i.lastSuccessAt.getTime() > 2 * i.effectiveIntervalMin * 60_000
  ) {
    return 'stale'
  }
  return 'ok'
}

export function nextRunAt(i: {
  enabled: boolean
  lastRunAt: Date | null
  effectiveIntervalMin: number
}): Date | null {
  if (!i.enabled || !i.lastRunAt) return null
  return new Date(i.lastRunAt.getTime() + i.effectiveIntervalMin * 60_000)
}

export const REQUIRED_CREDS: Record<SourceKey, string[]> = {
  x_api: ['X_BEARER_TOKEN'],
  x_apify: ['APIFY_TOKEN'],
  apify_instagram: ['APIFY_TOKEN'],
  apify_linkedin: ['APIFY_TOKEN'],
  youtube: ['YOUTUBE_API_KEY'],
  reddit: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
  web_search: ['SERPER_API_KEY'],
  news_rss: [],
  portal_chittorgarh: [],
  portal_investorgain: [],
  portal_ipowatch: [],
}

/** `configCreds` are env-style names saved (encrypted) in the source's creds_ref. */
export function resolveMode(
  key: SourceKey,
  env: Record<string, string | undefined>,
  configCreds: readonly string[],
): { mode: SourceMode; missingCreds: string[] } {
  const missingCreds = REQUIRED_CREDS[key].filter((n) => !env[n] && !configCreds.includes(n))
  const sm = env.SOURCES_MODE
  if (sm === 'fixture') return { mode: 'fixture', missingCreds }
  if (sm === 'live') return { mode: 'live', missingCreds }
  return { mode: missingCreds.length === 0 ? 'live' : 'fixture', missingCreds }
}

export function xModeLabel(
  xApiEnabled: boolean,
  xApiMode: SourceMode,
): 'Official API' | 'Apify fallback' {
  return xApiEnabled && xApiMode === 'live' ? 'Official API' : 'Apify fallback'
}

/** Smallest YouTube interval for which ceil(1440 / i) searches x 100 units fit the daily quota. */
export function minYoutubeIntervalMin(): number {
  for (let i = 1; i <= 1440; i++) {
    if (Math.ceil(1440 / i) * YOUTUBE_SEARCH_UNITS <= YOUTUBE_DAILY_QUOTA) return i
  }
  return 1440
}
