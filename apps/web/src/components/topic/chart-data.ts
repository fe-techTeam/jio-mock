// Pure shaping helpers for the topic detail page.
import type { HourPoint, MarketSeries, MarketSeriesPoints } from '@jio/core'
import type { EvidenceSlice } from '@/components/evidence/slice'
import { formatIst } from '@/components/shell/format'
import type { Filters } from '@/lib/api'

const HOUR_MS = 3_600_000

export type ChartRow = {
  hourStart: string
  /** '09:00 16 Oct' in IST. */
  label: string
  pos: number
  neu: number
  neg: number
  items: number
  market: number | null
}

/** One row per hour; `market` is the last point of the series inside [hourStart, +1h), else null. */
export function toChartRows(
  series: HourPoint[],
  market: MarketSeriesPoints,
  key: MarketSeries,
): ChartRow[] {
  const pts = (market[key] ?? [])
    .map((p) => ({ ms: Date.parse(p.t), v: p.v }))
    .filter((p) => Number.isFinite(p.ms))
    .sort((a, b) => a.ms - b.ms)
  const byHour = new Map<number, number>()
  for (const row of series) {
    const start = Date.parse(row.hourStart)
    byHour.set(start, NaN)
  }
  for (const p of pts) {
    // Hour starts are 30 minutes past the UTC hour; find the row whose window holds the point.
    for (const start of byHour.keys()) {
      if (p.ms >= start && p.ms < start + HOUR_MS) {
        byHour.set(start, p.v)
        break
      }
    }
  }
  return series.map((h) => {
    const v = byHour.get(Date.parse(h.hourStart))
    return {
      hourStart: h.hourStart,
      label: formatIst(h.hourStart, 'datetime'),
      pos: h.pos,
      neu: h.neu,
      neg: h.neg,
      items: h.items,
      market: v === undefined || Number.isNaN(v) ? null : v,
    }
  })
}

export function bucketSlice(slug: string, hourStart: string): EvidenceSlice {
  const to = new Date(Date.parse(hourStart) + HOUR_MS).toISOString()
  return { topic: slug, window: '7d', from: hourStart, to, sort: 'reach' }
}

export function dormantText(lastItemAt: string | null): string {
  if (!lastItemAt) return 'Dormant: no items yet'
  return `Dormant: last item ${formatIst(lastItemAt, 'datetime')}`
}

export function backHref(filters: Filters): string {
  const p = new URLSearchParams()
  if (filters.entity !== 'all') p.set('entity', filters.entity)
  if (filters.lane !== 'all') p.set('lane', filters.lane)
  const q = p.toString()
  return q ? `/?${q}` : '/'
}

export function marketLatest(
  market: MarketSeriesPoints,
  key: MarketSeries,
): { value: number; t: string } | null {
  let best: { value: number; t: string; ms: number } | null = null
  for (const p of market[key] ?? []) {
    const ms = Date.parse(p.t)
    if (Number.isFinite(ms) && (!best || ms >= best.ms)) best = { value: p.v, t: p.t, ms }
  }
  return best ? { value: best.value, t: best.t } : null
}
