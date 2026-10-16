import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { SEED_TOPICS } from '@jio/core'
import { topics } from '../schema'
import { connectTestDb, testDatabaseUrl, truncateAll } from '../testing'
import { listTopicDefs, upsertSeedTopics } from './topics'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

describe('upsertSeedTopics', () => {
  it('inserts the seed topics once and keeps edits on reseed', async () => {
    expect(await upsertSeedTopics(db)).toBe(SEED_TOPICS.length)
    await db.update(topics).set({ name: 'Renamed' }).where(eq(topics.slug, 'gmp-grey-market'))
    expect(await upsertSeedTopics(db)).toBe(0)
    const [row] = await db.select().from(topics).where(eq(topics.slug, 'gmp-grey-market'))
    expect(row!.name).toBe('Renamed')
  })
})

describe('listTopicDefs', () => {
  it('returns defs with id and status, filters by kind and hides dismissed topics', async () => {
    await upsertSeedTopics(db)
    await db.update(topics).set({ status: 'dismissed' }).where(eq(topics.slug, 'telecom-business'))

    const all = await listTopicDefs(db)
    expect(all).toHaveLength(SEED_TOPICS.length - 1)
    expect(all.find((t) => t.slug === 'telecom-business')).toBeUndefined()
    const gmp = all.find((t) => t.slug === 'gmp-grey-market')!
    expect(gmp).toMatchObject({ kind: 'seed', status: 'active', name: 'GMP and grey market' })
    expect(gmp.examplePhrases.length).toBeGreaterThan(0)
    expect(typeof gmp.id).toBe('string')

    const special = await listTopicDefs(db, { kinds: ['emerging', 'unclassified'] })
    expect(special.map((t) => t.slug).sort()).toEqual(['emerging', 'unclassified'])
  })
})
