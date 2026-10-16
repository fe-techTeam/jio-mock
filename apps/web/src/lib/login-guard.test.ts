import { describe, expect, it } from 'vitest'
import { clientIp, lockoutState } from './login-guard'

const T0 = new Date('2026-10-16T10:00:00Z').getTime()
const at = (min: number) => new Date(T0 + min * 60_000)

describe('lockoutState', () => {
  it('is unlocked for 4 failures', () => {
    expect(lockoutState([0, 1, 2, 3].map(at), at(4))).toEqual({ locked: false, until: null })
  })

  it('locks until the 5th failure plus 15 minutes', () => {
    const s = lockoutState([0, 1, 2, 3, 4].map(at), at(5))
    expect(s.locked).toBe(true)
    expect(s.until).toEqual(at(19))
  })

  it('is unlocked when no 5 failures fall inside 15 minutes', () => {
    expect(lockoutState([0, 5, 10, 15, 20].map(at), at(21))).toEqual({ locked: false, until: null })
  })

  it('is unlocked at exactly until', () => {
    const f = [0, 1, 2, 3, 4].map(at)
    expect(lockoutState(f, at(19)).locked).toBe(false)
    expect(lockoutState(f, new Date(at(19).getTime() - 1)).locked).toBe(true)
  })

  it('ignores input order', () => {
    const s = lockoutState([4, 0, 3, 1, 2].map(at), at(5))
    expect(s.locked).toBe(true)
    expect(s.until).toEqual(at(19))
  })
})

describe('clientIp', () => {
  it('prefers the first x-forwarded-for entry', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-real-ip': '1.1.1.1' })
    expect(clientIp(h)).toBe('203.0.113.7')
  })
  it('falls back to x-real-ip then unknown', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '1.1.1.1' }))).toBe('1.1.1.1')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
