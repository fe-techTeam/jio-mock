import { MARKET_SERIES, SOURCE_KEYS, type NormalizedMarketPoint } from '@jio/core'
import { marketPoints } from '../schema'
import type { DbLike } from './events'

export type InsertMarketPointsResult = { inserted: number; duplicates: number; rejected: number }

const CHUNK = 1000
const SERIES_SET: ReadonlySet<string> = new Set(MARKET_SERIES)
const SOURCE_SET: ReadonlySet<string> = new Set(SOURCE_KEYS)

/**
 * Inserts GMP and subscription points, deduped on (series, source_key, observed_at); an existing
 * point is never overwritten. Non-finite values, invalid dates and unknown series are rejected.
 */
export async function insertMarketPoints(
  db: DbLike,
  points: NormalizedMarketPoint[],
): Promise<InsertMarketPointsResult> {
  const result: InsertMarketPointsResult = { inserted: 0, duplicates: 0, rejected: 0 }
  if (points.length === 0) return result

  const rows = new Map<string, NormalizedMarketPoint>()
  for (const p of points) {
    if (
      !SERIES_SET.has(p?.series) ||
      !SOURCE_SET.has(p.sourceKey) ||
      typeof p.value !== 'number' ||
      !Number.isFinite(p.value) ||
      !(p.observedAt instanceof Date) ||
      Number.isNaN(p.observedAt.getTime()) ||
      typeof p.sourceUrl !== 'string'
    ) {
      result.rejected += 1
      continue
    }
    const key = `${p.series}\u0001${p.sourceKey}\u0001${p.observedAt.getTime()}`
    if (rows.has(key)) {
      result.duplicates += 1
      continue
    }
    rows.set(key, p)
  }

  const valid = [...rows.values()]
  for (let i = 0; i < valid.length; i += CHUNK) {
    const chunk = valid.slice(i, i + CHUNK)
    const inserted = await db
      .insert(marketPoints)
      .values(
        chunk.map((p) => ({
          series: p.series,
          value: p.value,
          observedAt: p.observedAt,
          sourceKey: p.sourceKey,
          sourceUrl: p.sourceUrl.replaceAll('\u0000', ''),
        })),
      )
      .onConflictDoNothing({
        target: [marketPoints.series, marketPoints.sourceKey, marketPoints.observedAt],
      })
      .returning({ id: marketPoints.id })
    result.inserted += inserted.length
  }
  result.duplicates += valid.length - result.inserted
  return result
}
