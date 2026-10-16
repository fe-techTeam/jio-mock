export type LockoutOptions = { maxFailures: number; windowMs: number; lockMs: number }
export type LockoutState = { locked: boolean; until: Date | null }

const DEFAULTS: LockoutOptions = { maxFailures: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 }

/**
 * Locked while now is before (last of any `maxFailures` consecutive failures that fit inside
 * `windowMs`) + `lockMs`. The latest such window decides. At exactly `until` the lock is over.
 */
export function lockoutState(
  failures: Date[],
  now: Date,
  opts: LockoutOptions = DEFAULTS,
): LockoutState {
  const t = failures.map((d) => d.getTime()).sort((a, b) => a - b)
  let until: number | null = null
  for (let i = opts.maxFailures - 1; i < t.length; i++) {
    if (t[i]! - t[i - (opts.maxFailures - 1)]! <= opts.windowMs) until = t[i]! + opts.lockMs
  }
  if (until !== null && now.getTime() < until) return { locked: true, until: new Date(until) }
  return { locked: false, until: null }
}

/** Client address behind the proxy: first x-forwarded-for entry, then x-real-ip. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (fwd) return fwd
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
