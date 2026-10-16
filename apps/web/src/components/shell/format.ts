// Display helpers. Every on-screen time is IST (Asia/Kolkata), whatever the viewer's zone.

const IST = 'Asia/Kolkata'

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dayFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: 'numeric',
  month: 'short',
})

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((p) => p.type === type)?.value ?? ''
}

function hhmm(d: Date): string {
  const parts = timeFmt.formatToParts(d)
  return `${part(parts, 'hour').padStart(2, '0')}:${part(parts, 'minute').padStart(2, '0')}`
}

function dayMonth(d: Date): string {
  const parts = dayFmt.formatToParts(d)
  return `${part(parts, 'day')} ${part(parts, 'month')}`
}

/** 'time' -> '09:30 IST'; 'datetime' -> '09:30 16 Oct' (IST). */
export function formatIst(iso: string, mode: 'time' | 'datetime' = 'time'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return mode === 'time' ? `${hhmm(d)} IST` : `${hhmm(d)} ${dayMonth(d)}`
}

/** '09:00-10:00 16 Oct IST'; the day of each end is shown when they differ. */
export function formatIstRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '-'
  const fromDay = dayMonth(from)
  const toDay = dayMonth(to)
  if (fromDay === toDay) return `${hhmm(from)}-${hhmm(to)} ${toDay} IST`
  return `${hhmm(from)} ${fromDay}-${hhmm(to)} ${toDay} IST`
}

export type SplitPct = { pos: number; neu: number; neg: number }

/** Largest-remainder rounding: integer percentages that sum to 100 (all zero -> 0/0/0). */
export function pctSplit(c: SplitPct): SplitPct {
  const keys = ['pos', 'neu', 'neg'] as const
  const total = c.pos + c.neu + c.neg
  if (total <= 0) return { pos: 0, neu: 0, neg: 0 }
  const raw = keys.map((k) => (c[k] / total) * 100)
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i] = (floors[i] ?? 0) + 1
    left -= 1
  }
  return { pos: floors[0] ?? 0, neu: floors[1] ?? 0, neg: floors[2] ?? 0 }
}

/** '4 min' under two hours, else whole hours ('3 h'). */
export function formatAge(min: number): string {
  if (min < 120) return `${Math.max(0, Math.round(min))} min`
  return `${Math.floor(min / 60)} h`
}

const countFmt = new Intl.NumberFormat('en-IN')

/** Indian digit grouping: 12,34,567. */
export function formatCount(n: number): string {
  return countFmt.format(n)
}

/** Signed percent change, e.g. '+40%' / '-12%' / '0%'. */
export function formatDeltaPct(pct: number): string {
  const r = Math.round(pct)
  return r > 0 ? `+${r}%` : `${r}%`
}
