// Bucket-aligned read windows. Rollup buckets are 15-minute UTC quarter-hours, which are also IST
// quarter-hours (IST = UTC+05:30). Every range is half-open [from, to).
import { hourStartIst } from '@jio/core/time'

export const BUCKET_MS = 15 * 60_000
export const HOUR_MS = 60 * 60_000
export const DAY_MS = 24 * HOUR_MS
export const WINDOW_BUCKETS = 96

/** Origin for IST hours in SQL: date_bin('1 hour', ts, IST_HOUR_ORIGIN::timestamptz). */
export const IST_HOUR_ORIGIN = '2000-01-01 00:30:00+00'

export type Range = { from: Date; to: Date }

export function floor15(d: Date): Date {
  return new Date(Math.floor(d.getTime() / BUCKET_MS) * BUCKET_MS)
}

/** The end of the bucket holding `now`: windows include the bucket in progress. */
function windowEnd(now: Date): Date {
  return new Date(floor15(now).getTime() + BUCKET_MS)
}

/** cur = the 96 buckets ending with the current one; prev = the 96 before them. */
export function windowRanges(now: Date): { cur: Range; prev: Range } {
  const to = windowEnd(now)
  const from = new Date(to.getTime() - DAY_MS)
  return { cur: { from, to }, prev: { from: new Date(from.getTime() - DAY_MS), to: from } }
}

/** The 672 buckets ending with the current one. */
export function range7d(now: Date): Range {
  const to = windowEnd(now)
  return { from: new Date(to.getTime() - 7 * DAY_MS), to }
}

/** Start of the IST hour holding d (IST hours start at :30 UTC). */
export function floorIstHour(d: Date): Date {
  return hourStartIst(d)
}

/** The n IST hour starts ending with the current IST hour, oldest first. */
export function istHours(now: Date, n: number): Date[] {
  const last = floorIstHour(now).getTime()
  return Array.from({ length: n }, (_, i) => new Date(last - (n - 1 - i) * HOUR_MS))
}
