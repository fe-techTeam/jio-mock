// Circuit breaker and source error classes. The breaker holds no memory: its inputs come from
// event_log (sourceHealth().consecutiveFailures and the latest fetch_run `at`), so it survives restarts.

export const BREAKER_THRESHOLD = 3
export const BREAKER_MAX_COOLDOWN_MIN = 120

export type BreakerState = 'closed' | 'open' | 'half_open'

export interface BreakerInput {
  /** Error runs since the last ok run (sourceHealth). rate_limited runs do not count. */
  consecutiveFailures: number
  /** `at` of the latest fetch_run event of this source. */
  lastAttemptAt: Date | null
}

/** min(intervalMin * 2^(failures - 3), 120) minutes. */
export function breakerCooldownMin(intervalMin: number, consecutiveFailures: number): number {
  const exp = Math.max(0, consecutiveFailures - BREAKER_THRESHOLD)
  return Math.min(intervalMin * 2 ** exp, BREAKER_MAX_COOLDOWN_MIN)
}

/**
 * closed below BREAKER_THRESHOLD failures; open while the cooldown since the last attempt runs;
 * half_open after it (one trial run is allowed; its failure re-opens with a doubled cooldown).
 */
export function breakerState(input: BreakerInput, intervalMin: number, now: Date): BreakerState {
  if (input.consecutiveFailures < BREAKER_THRESHOLD) return 'closed'
  if (!input.lastAttemptAt) return 'half_open'
  const cooldownMs = breakerCooldownMin(intervalMin, input.consecutiveFailures) * 60_000
  return now.getTime() - input.lastAttemptAt.getTime() >= cooldownMs ? 'half_open' : 'open'
}

/** The provider said "slow down"; the scheduler skips the source until `resetAt`. */
export class RateLimitedError extends Error {
  readonly resetAt: Date
  constructor(message: string, resetAt: Date) {
    super(message)
    this.name = 'RateLimitedError'
    this.resetAt = resetAt
  }
}

/** Credentials were rejected (401/403). */
export class SourceAuthError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SourceAuthError'
  }
}

/** The provider answered but the payload did not have the expected shape. */
export class SourceParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SourceParseError'
  }
}

/** Live mode was requested but the source is missing credentials or a live implementation. */
export class NotConfiguredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'NotConfiguredError'
  }
}
