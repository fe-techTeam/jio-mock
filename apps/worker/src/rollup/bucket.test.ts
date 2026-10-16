import { describe, expect, it } from 'vitest'
import { BUCKET_MS, bucketStart, bucketRanges, resolveRollupMode } from './index'

describe('bucketStart', () => {
  it('floors to the IST quarter-hour (IST is UTC+05:30)', () => {
    const d = new Date('2026-10-16T09:14:59+05:30')
    expect(bucketStart(d).toISOString()).toBe(new Date('2026-10-16T09:00:00+05:30').toISOString())
  })

  it('keeps an exact boundary and floors the millisecond before it', () => {
    const b = new Date('2026-10-16T03:45:00Z')
    expect(bucketStart(b).getTime()).toBe(b.getTime())
    expect(bucketStart(new Date(b.getTime() - 1)).toISOString()).toBe('2026-10-16T03:30:00.000Z')
  })

  it('15 minutes is the bucket width', () => {
    expect(BUCKET_MS).toBe(900_000)
  })
})

describe('resolveRollupMode', () => {
  it('runs full7d at UTC minute 7 and recent otherwise', () => {
    expect(resolveRollupMode(new Date('2026-10-16T05:07:30Z'))).toBe('full7d')
    expect(resolveRollupMode(new Date('2026-10-16T05:08:00Z'))).toBe('recent')
    expect(resolveRollupMode(new Date('2026-10-16T05:07:30Z'), 'recent')).toBe('recent')
  })
})

describe('bucketRanges', () => {
  it('merges contiguous buckets into half-open ranges', () => {
    const t = (s: string) => new Date(`2026-10-16T${s}:00Z`)
    const ranges = bucketRanges([t('04:00'), t('03:45'), t('03:00'), t('03:45')])
    expect(ranges.map((r) => [r.from.toISOString(), r.to.toISOString()])).toEqual([
      ['2026-10-16T03:00:00.000Z', '2026-10-16T03:15:00.000Z'],
      ['2026-10-16T03:45:00.000Z', '2026-10-16T04:15:00.000Z'],
    ])
    expect(bucketRanges([])).toEqual([])
  })
})
