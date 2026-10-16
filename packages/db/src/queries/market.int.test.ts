import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedMarketPoint } from '@jio/core'
import type { Db } from '../client'
import { marketPoints } from '../schema'
import { connectTestDb, testDatabaseUrl, truncateAll } from '../testing'
import { insertMarketPoints } from './market'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

const point = (extra: Partial<NormalizedMarketPoint> = {}): NormalizedMarketPoint => ({
  series: 'gmp_inr',
  value: 120,
  observedAt: new Date('2026-10-16T05:00:00Z'),
  sourceKey: 'portal_chittorgarh',
  sourceUrl: 'https://www.chittorgarh.com/ipo/jio',
  ...extra,
})

describe('insertMarketPoints', () => {
  it('inserts new points and counts duplicates on (series, source_key, observed_at)', async () => {
    const batch = [point(), point({ series: 'sub_total_x', value: 2.5 })]
    expect(await insertMarketPoints(db, batch)).toEqual({ inserted: 2, duplicates: 0, rejected: 0 })
    const again = await insertMarketPoints(db, [
      ...batch,
      point({ value: 130 }), // same key as batch[0]
      point({ sourceKey: 'portal_ipowatch' }),
    ])
    expect(again).toEqual({ inserted: 1, duplicates: 3, rejected: 0 })
    const rows = await db.select().from(marketPoints)
    expect(rows).toHaveLength(3)
    expect(
      rows.find((r) => r.series === 'gmp_inr' && r.sourceKey === 'portal_chittorgarh')!.value,
    ).toBe(120)
  })

  it('rejects NaN, Infinity, bad dates and unknown series', async () => {
    const res = await insertMarketPoints(db, [
      point({ value: Number.NaN }),
      point({ value: Number.POSITIVE_INFINITY }),
      point({ observedAt: new Date('nope') }),
      point({ series: 'gmp_usd' as NormalizedMarketPoint['series'] }),
      point({ value: -5 }),
    ])
    expect(res).toEqual({ inserted: 1, duplicates: 0, rejected: 4 })
  })

  it('runs no queries for an empty array', async () => {
    const noDb = new Proxy({} as Db, {
      get() {
        throw new Error('no query expected')
      },
    })
    expect(await insertMarketPoints(noDb, [])).toEqual({ inserted: 0, duplicates: 0, rejected: 0 })
  })
})
