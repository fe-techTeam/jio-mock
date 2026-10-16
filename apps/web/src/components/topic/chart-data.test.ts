// @vitest-environment node
import type { HourPoint, MarketSeriesPoints } from '@jio/core'
import { describe, expect, it } from 'vitest'
import { backHref, bucketSlice, dormantText, marketLatest, toChartRows } from './chart-data'

const START = Date.parse('2026-10-10T03:30:00Z') // 09:00 IST
const series: HourPoint[] = Array.from({ length: 168 }, (_, i) => ({
  hourStart: new Date(START + i * 3_600_000).toISOString(),
  items: i,
  pos: 1,
  neu: 2,
  neg: 3,
  lowConf: 0,
}))
const emptyMarket = (): MarketSeriesPoints => ({
  gmp_inr: [],
  sub_retail_x: [],
  sub_nii_x: [],
  sub_qib_x: [],
  sub_total_x: [],
})

describe('toChartRows', () => {
  it('keeps 168 rows in order with IST labels', () => {
    const rows = toChartRows(series, emptyMarket(), 'gmp_inr')
    expect(rows).toHaveLength(168)
    expect(rows[0]?.label).toBe('09:00 10 Oct')
    expect(rows[0]?.market).toBeNull()
    expect(rows[5]?.items).toBe(5)
  })

  it('places a point in its IST hour and does not carry forward', () => {
    const m = emptyMarket()
    m.gmp_inr = [{ t: '2026-10-16T03:50:00Z', v: 42 }]
    const rows = toChartRows(series, m, 'gmp_inr')
    const hit = rows.find((r) => r.hourStart === '2026-10-16T03:30:00.000Z')
    const before = rows.find((r) => r.hourStart === '2026-10-16T02:30:00.000Z')
    const after = rows.find((r) => r.hourStart === '2026-10-16T04:30:00.000Z')
    expect(hit?.market).toBe(42)
    expect(before?.market).toBeNull()
    expect(after?.market).toBeNull()
  })

  it('keeps the later of two points in one hour', () => {
    const m = emptyMarket()
    m.gmp_inr = [
      { t: '2026-10-16T03:40:00Z', v: 40 },
      { t: '2026-10-16T03:10:00Z', v: 30 },
      { t: '2026-10-16T03:55:00Z', v: 45 },
    ]
    const rows = toChartRows(series, m, 'gmp_inr')
    expect(rows.find((r) => r.hourStart === '2026-10-16T03:30:00.000Z')?.market).toBe(45)
    // 03:10Z is in the previous hour [02:30, 03:30)
    expect(rows.find((r) => r.hourStart === '2026-10-16T02:30:00.000Z')?.market).toBe(30)
  })
})

describe('helpers', () => {
  it('bucketSlice spans one hour', () => {
    const s = bucketSlice('gmp-grey-market', '2026-10-16T03:30:00.000Z')
    expect(s).toEqual({
      topic: 'gmp-grey-market',
      window: '7d',
      from: '2026-10-16T03:30:00.000Z',
      to: '2026-10-16T04:30:00.000Z',
      sort: 'reach',
    })
  })

  it('dormantText', () => {
    expect(dormantText('2026-10-12T08:35:00Z')).toBe('Dormant: last item 14:05 12 Oct')
    expect(dormantText(null)).toBe('Dormant: no items yet')
  })

  it('backHref keeps non-all filters only', () => {
    expect(backHref({ entity: 'isha', lane: 'all' })).toBe('/?entity=isha')
    expect(backHref({ entity: 'all', lane: 'all' })).toBe('/')
    expect(backHref({ entity: 'isha', lane: 'social' })).toBe('/?entity=isha&lane=social')
  })

  it('marketLatest returns the newest point or null', () => {
    const m = emptyMarket()
    expect(marketLatest(m, 'gmp_inr')).toBeNull()
    m.gmp_inr = [
      { t: '2026-10-16T03:00:00Z', v: 1 },
      { t: '2026-10-16T05:00:00Z', v: 2 },
    ]
    expect(marketLatest(m, 'gmp_inr')).toEqual({ value: 2, t: '2026-10-16T05:00:00Z' })
  })
})
