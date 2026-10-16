import { describe, expect, it } from 'vitest'
import {
  BREAKER_MAX_COOLDOWN_MIN,
  BREAKER_THRESHOLD,
  NotConfiguredError,
  RateLimitedError,
  SourceAuthError,
  SourceParseError,
  breakerCooldownMin,
  breakerState,
} from './breaker'

const NOW = new Date('2026-10-19T06:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)

describe('breakerState', () => {
  it('is closed with no attempts', () => {
    expect(breakerState({ consecutiveFailures: 0, lastAttemptAt: null }, 5, NOW)).toBe('closed')
  })

  it('stays closed below the threshold', () => {
    expect(BREAKER_THRESHOLD).toBe(3)
    expect(breakerState({ consecutiveFailures: 2, lastAttemptAt: minsAgo(0) }, 5, NOW)).toBe(
      'closed',
    )
  })

  it('opens at 3 failures inside the cooldown', () => {
    // cooldown = 5 * 2^0 = 5 minutes
    expect(breakerState({ consecutiveFailures: 3, lastAttemptAt: minsAgo(4) }, 5, NOW)).toBe('open')
  })

  it('goes half_open once the cooldown has passed', () => {
    expect(breakerState({ consecutiveFailures: 3, lastAttemptAt: minsAgo(5) }, 5, NOW)).toBe(
      'half_open',
    )
  })

  it('doubles the cooldown per extra failure', () => {
    expect(breakerCooldownMin(5, 3)).toBe(5)
    expect(breakerCooldownMin(5, 4)).toBe(10)
    expect(breakerCooldownMin(5, 5)).toBe(20)
    // 4 failures: 10 minute cooldown
    expect(breakerState({ consecutiveFailures: 4, lastAttemptAt: minsAgo(9) }, 5, NOW)).toBe('open')
    expect(breakerState({ consecutiveFailures: 4, lastAttemptAt: minsAgo(10) }, 5, NOW)).toBe(
      'half_open',
    )
  })

  it('caps the cooldown at 120 minutes', () => {
    expect(BREAKER_MAX_COOLDOWN_MIN).toBe(120)
    expect(breakerCooldownMin(60, 10)).toBe(120)
    expect(breakerState({ consecutiveFailures: 10, lastAttemptAt: minsAgo(119) }, 60, NOW)).toBe(
      'open',
    )
    expect(breakerState({ consecutiveFailures: 10, lastAttemptAt: minsAgo(120) }, 60, NOW)).toBe(
      'half_open',
    )
  })

  it('treats a failure count without a timestamp as half_open', () => {
    expect(breakerState({ consecutiveFailures: 3, lastAttemptAt: null }, 5, NOW)).toBe('half_open')
  })
})

describe('source error classes', () => {
  it('RateLimitedError keeps resetAt and name', () => {
    const resetAt = new Date('2026-10-19T06:15:00Z')
    const e = new RateLimitedError('429 from X', resetAt)
    expect(e).toBeInstanceOf(Error)
    expect(e.resetAt).toEqual(resetAt)
    expect(e.name).toBe('RateLimitedError')
    expect(e.message).toBe('429 from X')
  })

  it.each([
    [SourceAuthError, 'SourceAuthError'],
    [SourceParseError, 'SourceParseError'],
    [NotConfiguredError, 'NotConfiguredError'],
  ] as const)('%o has its own name', (Cls, name) => {
    const e = new Cls('boom')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(Cls)
    expect(e.name).toBe(name)
    expect(e.message).toBe('boom')
  })
})
