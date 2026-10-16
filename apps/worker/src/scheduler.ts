// Fetch scheduler. planTick is pure: given config, the latest fetch_run per source, source health
// and each source's resolved mode, it decides which sources to enqueue this tick.
import { SOURCE_KEYS, type AppConfig, type SourceConfig, type SourceKey } from '@jio/core'
import { isIndianMarketHours } from '@jio/core/time'
import { breakerState } from './breaker'

/**
 * How a source would run right now. `fixture` says why: SOURCES_MODE=fixture forces it, or auto
 * mode found no credentials. `unconfigured`: SOURCES_MODE=live but credentials are missing.
 */
export type ResolvedMode =
  | { mode: 'live' }
  | { mode: 'fixture'; reason: 'sources_mode' | 'missing_creds'; missing?: string[] }
  | { mode: 'unconfigured'; missing: string[] }

export type SkipReason =
  | 'disabled'
  | 'not_due'
  | 'circuit_open'
  | 'rate_limited'
  | 'unconfigured'
  | 'x_primary_active'
  | 'x_primary_inactive'

/** The latest fetch_run event of a source. */
export interface LatestRun {
  sourceKey: SourceKey
  at: Date
  status: string | null
  detail: Record<string, unknown>
}

/** The part of @jio/db SourceHealthRow the planner reads. */
export interface HealthLike {
  sourceKey: SourceKey
  consecutiveFailures: number
}

export interface PlanTickInput {
  now: Date
  config: AppConfig
  runs: LatestRun[]
  health: HealthLike[]
  modes: Record<SourceKey, ResolvedMode>
}

export interface PlanTickResult {
  enqueue: SourceKey[]
  skipped: { key: SourceKey; reason: SkipReason }[]
}

/**
 * A tick that fires a little early (timer drift) still counts as due, so a 2-minute source polled
 * by a 60s tick runs every 2 minutes rather than every 3.
 */
const TICK_SLACK_MS = 5_000

/**
 * A source with a market-hours interval (the portals) uses it during 09:15-15:30 IST Mon-Fri.
 * NSE holidays are not modelled: a weekday holiday counts as market hours.
 */
export function effectiveIntervalMin(_key: SourceKey, source: SourceConfig, now: Date): number {
  if (source.market_hours_interval_min != null && isIndianMarketHours(now)) {
    return source.market_hours_interval_min
  }
  return source.interval_min
}

export function isDue(lastAttemptAt: Date | null, intervalMin: number, now: Date): boolean {
  if (!lastAttemptAt) return true
  return now.getTime() - lastAttemptAt.getTime() >= intervalMin * 60_000 - TICK_SLACK_MS
}

/** detail.rateLimitedUntil of a rate_limited latest run, when still in the future. */
export function rateLimitedUntil(run: LatestRun | undefined, now: Date): Date | null {
  if (!run || run.status !== 'rate_limited') return null
  const raw = run.detail.rateLimitedUntil
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const until = new Date(raw)
  if (Number.isNaN(until.getTime())) return null
  return until.getTime() > now.getTime() ? until : null
}

export function planTick(input: PlanTickInput): PlanTickResult {
  const { now, config } = input
  const runs = new Map(input.runs.map((r) => [r.sourceKey, r]))
  const failures = new Map(input.health.map((h) => [h.sourceKey, h.consecutiveFailures]))

  const circuitOpen = (key: SourceKey) => {
    const interval = effectiveIntervalMin(key, config.sources[key], now)
    const state = breakerState(
      { consecutiveFailures: failures.get(key) ?? 0, lastAttemptAt: runs.get(key)?.at ?? null },
      interval,
      now,
    )
    return state === 'open'
  }

  // X primary/fallback: x_api is the active X route when it is enabled, runnable (live, or fixture
  // forced by SOURCES_MODE=fixture), not rate-limited and its circuit is not open.
  const xMode = input.modes.x_api
  const xPrimaryActive =
    config.sources.x_api.enabled &&
    (xMode.mode === 'live' || (xMode.mode === 'fixture' && xMode.reason === 'sources_mode')) &&
    !rateLimitedUntil(runs.get('x_api'), now) &&
    !circuitOpen('x_api')

  const out: PlanTickResult = { enqueue: [], skipped: [] }
  const skip = (key: SourceKey, reason: SkipReason) => out.skipped.push({ key, reason })

  for (const key of SOURCE_KEYS) {
    const source = config.sources[key]
    if (!source.enabled) {
      skip(key, 'disabled')
      continue
    }
    const mode = input.modes[key]
    if (key === 'x_api' && !xPrimaryActive && mode.mode !== 'live') {
      skip(key, 'x_primary_inactive')
      continue
    }
    if (key === 'x_apify' && xPrimaryActive) {
      skip(key, 'x_primary_active')
      continue
    }
    if (mode.mode === 'unconfigured') {
      skip(key, 'unconfigured')
      continue
    }
    if (rateLimitedUntil(runs.get(key), now)) {
      skip(key, 'rate_limited')
      continue
    }
    if (circuitOpen(key)) {
      skip(key, 'circuit_open')
      continue
    }
    const last = runs.get(key)?.at ?? null
    if (!isDue(last, effectiveIntervalMin(key, source, now), now)) {
      skip(key, 'not_due')
      continue
    }
    out.enqueue.push(key)
  }
  return out
}
