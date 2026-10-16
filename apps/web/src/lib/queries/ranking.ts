// Ranking, trend and threshold rules for the brief. Pure functions, decided once here.
import type { ReachSplit, Trend } from '@jio/core'

export const DEFAULT_ACTIVE_MIN = 10
export const DEFAULT_MIN_FOR_SPLIT = 30
const TREND_THRESHOLD_PCT = 10

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function trendOf(cur: number, prev: number): { trend: Trend; deltaPct: number | null } {
  if (prev === 0) return { trend: cur > 0 ? 'new' : 'flat', deltaPct: null }
  const deltaPct = round1(((cur - prev) / prev) * 100)
  const trend: Trend =
    deltaPct >= TREND_THRESHOLD_PCT ? 'up' : deltaPct <= -TREND_THRESHOLD_PCT ? 'down' : 'flat'
  return { trend, deltaPct }
}

/**
 * sqrt(items x uniqueAuthors) x velocity, velocity = (items+1)/(prev+1) clamped to [0.5, 3].
 * Many distinct voices outrank a few loud ones; a fast-growing topic gets up to 3x.
 */
export function rankScore(r: { items: number; prev: number; uniqueAuthors: number }): number {
  const velocity = clamp((r.items + 1) / (r.prev + 1), 0.5, 3)
  return Math.sqrt(r.items * r.uniqueAuthors) * velocity
}

/** Score desc, then items desc, then name asc. Returns a new array. */
export function rankTopics<T extends { score: number; items: number; name: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) => b.score - a.score || b.items - a.items || a.name.localeCompare(b.name),
  )
}

export function isActive(items: number, activeMin = DEFAULT_ACTIVE_MIN): boolean {
  return items >= activeMin
}

export function splitShown(n: number, min = DEFAULT_MIN_FOR_SPLIT): boolean {
  return n >= min
}

export function lowConfPct(lowConf: number, items: number): number {
  return items > 0 ? round1((lowConf / items) * 100) : 0
}

/** Integer percents of pos/neu/neg that sum to 100 (largest remainder, ties to the earlier key). */
export function percentSplit(c: ReachSplit): ReachSplit {
  const keys = ['pos', 'neu', 'neg'] as const
  const total = c.pos + c.neu + c.neg
  if (!(total > 0)) return { pos: 0, neu: 0, neg: 0 }
  const raw = keys.map((k) => (Math.max(0, c[k]) / total) * 100)
  const out = raw.map(Math.floor)
  let left = 100 - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, rem: r - Math.floor(r) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left -= 1
  }
  return { pos: out[0] ?? 0, neu: out[1] ?? 0, neg: out[2] ?? 0 }
}

/**
 * The reach-weighted split for a slice: null under `min` items (the 30-item rule) or when the
 * reach sums add to 0; otherwise integer percents summing to 100.
 */
export function reachSplit(
  reach: ReachSplit,
  items: number,
  min = DEFAULT_MIN_FOR_SPLIT,
): ReachSplit | null {
  if (!splitShown(items, min)) return null
  if (!(reach.pos + reach.neu + reach.neg > 0)) return null
  return percentSplit(reach)
}
