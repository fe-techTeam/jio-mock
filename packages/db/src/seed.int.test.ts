import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { DEFAULT_CONFIG } from '@jio/core'
import { getLatestConfig } from './queries/config'
import { configVersions, topics } from './schema'
import { seedBase } from './seed'
import { connectTestDb, testDatabaseUrl, truncateAll } from './testing'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

describe('seedBase', () => {
  it('creates config v1 and the 12 topics once', async () => {
    expect(await seedBase(db)).toEqual({
      configVersion: 1,
      configCreated: true,
      topicsInserted: 12,
    })
    expect(await seedBase(db)).toEqual({
      configVersion: 1,
      configCreated: false,
      topicsInserted: 0,
    })

    const versions = await db.select().from(configVersions)
    expect(versions).toHaveLength(1)
    expect(versions[0]!.actor).toBe('seed')
    expect((await getLatestConfig(db)).config).toEqual(DEFAULT_CONFIG)

    const rows = await db.select().from(topics)
    expect(rows).toHaveLength(12)
    expect(rows.filter((t) => t.kind === 'seed')).toHaveLength(10)
    expect(rows.map((t) => t.slug)).toEqual(expect.arrayContaining(['emerging', 'unclassified']))
  })

  it('keeps a renamed topic on reseed', async () => {
    await seedBase(db)
    await db.update(topics).set({ name: 'GMP talk' }).where(eq(topics.slug, 'gmp-grey-market'))
    await seedBase(db)
    const [row] = await db.select().from(topics).where(eq(topics.slug, 'gmp-grey-market'))
    expect(row!.name).toBe('GMP talk')
  })

  it('does not overwrite a newer saved config', async () => {
    await seedBase(db)
    await db.insert(configVersions).values({ version: 2, actor: 'x', config: DEFAULT_CONFIG })
    expect((await seedBase(db)).configVersion).toBe(2)
    expect(await db.select().from(configVersions)).toHaveLength(2)
  })
})
