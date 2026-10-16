import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  bucketStart15m,
  formatIst,
  hourStartIst,
  isIndianMarketHours,
  startOfIstDay,
  MARKET_CLOSE_MIN_IST,
  MARKET_OPEN_MIN_IST,
  toIstParts,
} from './time'

afterEach(() => vi.unstubAllEnvs())

describe('isIndianMarketHours', () => {
  it('opens at 09:15 IST Monday', () => {
    expect(isIndianMarketHours(new Date('2026-10-19T03:45:00Z'))).toBe(true)
    expect(isIndianMarketHours(new Date('2026-10-19T03:44:59.999Z'))).toBe(false)
  })
  it('closes at 15:30 IST (exclusive)', () => {
    expect(isIndianMarketHours(new Date('2026-10-19T09:59:59Z'))).toBe(true)
    expect(isIndianMarketHours(new Date('2026-10-19T10:00:00Z'))).toBe(false)
  })
  it('is true on a Friday midday', () => {
    expect(isIndianMarketHours(new Date('2026-10-16T05:00:00Z'))).toBe(true)
  })
  it('is false on weekends', () => {
    expect(isIndianMarketHours(new Date('2026-10-17T05:00:00Z'))).toBe(false)
    expect(isIndianMarketHours(new Date('2026-10-18T05:00:00Z'))).toBe(false)
  })
  it('uses IST weekday, not UTC', () => {
    expect(isIndianMarketHours(new Date('2026-10-16T19:00:00Z'))).toBe(false)
  })
  it('ignores process TZ', () => {
    vi.stubEnv('TZ', 'America/New_York')
    expect(isIndianMarketHours(new Date('2026-10-19T03:45:00Z'))).toBe(true)
    expect(isIndianMarketHours(new Date('2026-10-19T03:44:00Z'))).toBe(false)
  })
  it('exposes window constants', () => {
    expect(MARKET_OPEN_MIN_IST).toBe(555)
    expect(MARKET_CLOSE_MIN_IST).toBe(930)
  })
})

describe('toIstParts', () => {
  it('rolls over to the next IST day', () => {
    const p = toIstParts(new Date('2026-10-16T19:00:00Z'))
    expect(p).toMatchObject({
      year: 2026,
      month: 10,
      day: 17,
      weekday: 6,
      hour: 0,
      minute: 30,
      second: 0,
    })
  })
  it('gives Friday weekday 5', () => {
    expect(toIstParts(new Date('2026-10-16T05:00:00Z')).weekday).toBe(5)
  })
})

describe('buckets', () => {
  it('bucketStart15m floors to 15 minutes', () => {
    expect(bucketStart15m(new Date('2026-10-16T04:07:30Z')).toISOString()).toBe(
      '2026-10-16T04:00:00.000Z',
    )
  })
  it('hourStartIst floors to the IST hour', () => {
    expect(hourStartIst(new Date('2026-10-16T04:07:30Z')).toISOString()).toBe(
      '2026-10-16T03:30:00.000Z',
    )
    expect(hourStartIst(new Date('2026-10-16T03:30:00Z')).toISOString()).toBe(
      '2026-10-16T03:30:00.000Z',
    )
  })
})

describe('formatIst', () => {
  it('formats in IST', () => {
    expect(formatIst(new Date('2026-10-16T04:07:30Z'))).toBe('16 Oct 2026, 09:37 IST')
  })
})

describe('startOfIstDay', () => {
  it('returns IST midnight of the next IST day when UTC is still the previous day', () => {
    expect(startOfIstDay(new Date('2026-10-16T19:00:00Z')).toISOString()).toBe(
      '2026-10-16T18:30:00.000Z',
    )
  })
  it('floors a midday time to the same IST midnight', () => {
    expect(startOfIstDay(new Date('2026-10-16T05:00:00Z')).toISOString()).toBe(
      '2026-10-15T18:30:00.000Z',
    )
  })
  it('is idempotent at exactly IST midnight', () => {
    const m = new Date('2026-10-16T18:30:00.000Z')
    expect(startOfIstDay(m).getTime()).toBe(m.getTime())
    expect(startOfIstDay(new Date(m.getTime() - 1)).toISOString()).toBe('2026-10-15T18:30:00.000Z')
  })
})
