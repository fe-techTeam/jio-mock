import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import { DEFAULT_CONFIG, type AppConfig } from '@jio/core'
import { configVersions, eventLog } from '../schema'
import { connectTestDb, testDatabaseUrl, truncateAll } from '../testing'
import { ConfigConflictError, ConfigParseError, getLatestConfig, saveConfigVersion } from './config'

const { db, sql } = connectTestDb(testDatabaseUrl('jio_ipo_test'))

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

beforeEach(async () => {
  await truncateAll(sql)
})

describe('getLatestConfig', () => {
  it('returns version 0 and DEFAULT_CONFIG for an empty table', async () => {
    expect(await getLatestConfig(db)).toEqual({ version: 0, savedAt: null, config: DEFAULT_CONFIG })
  })

  it('fills defaults for keys missing from an older row', async () => {
    const raw: Record<string, unknown> = structuredClone(DEFAULT_CONFIG)
    delete raw.retention_days
    delete raw.min_items_for_split
    await db.insert(configVersions).values({ version: 1, actor: 'old', config: raw as AppConfig })
    const latest = await getLatestConfig(db)
    expect(latest.version).toBe(1)
    expect(latest.savedAt).toBeInstanceOf(Date)
    expect(latest.config.retention_days).toEqual({ raw_json: 30, post_text: 90, authors: 90 })
    expect(latest.config.min_items_for_split).toBe(30)
  })

  it('wraps an unparseable row in ConfigParseError with its version', async () => {
    await db
      .insert(configVersions)
      .values({ version: 3, actor: 'x', config: { terms: 1 } as unknown as AppConfig })
    const err = await getLatestConfig(db).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConfigParseError)
    expect((err as ConfigParseError).version).toBe(3)
  })
})

describe('saveConfigVersion', () => {
  it('writes contiguous versions and a config_change event for each', async () => {
    expect(await saveConfigVersion(db, DEFAULT_CONFIG, 'strategy@jio.local')).toBe(1)
    const next = { ...DEFAULT_CONFIG, backfill_days: 3 }
    expect(await saveConfigVersion(db, next, 'strategy@jio.local')).toBe(2)

    const latest = await getLatestConfig(db)
    expect(latest.version).toBe(2)
    expect(latest.config.backfill_days).toBe(3)

    const events = await db
      .select()
      .from(eventLog)
      .where(eq(eventLog.kind, 'config_change'))
      .orderBy(asc(eventLog.id))
    expect(events.map((e) => e.detail)).toEqual([
      { version: 1, previousVersion: null },
      { version: 2, previousVersion: 1 },
    ])
    expect(events[0]!.actor).toBe('strategy@jio.local')
  })

  it('throws ConfigConflictError on a stale expectedVersion and inserts nothing', async () => {
    await saveConfigVersion(db, DEFAULT_CONFIG, 'a')
    await saveConfigVersion(db, DEFAULT_CONFIG, 'a')
    const err = await saveConfigVersion(db, DEFAULT_CONFIG, 'b', { expectedVersion: 1 }).catch(
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ConfigConflictError)
    expect((err as ConfigConflictError).latestVersion).toBe(2)
    expect(await db.select().from(configVersions)).toHaveLength(2)
    expect(await db.select().from(eventLog)).toHaveLength(2)
  })

  it('accepts a matching expectedVersion', async () => {
    await saveConfigVersion(db, DEFAULT_CONFIG, 'a')
    expect(await saveConfigVersion(db, DEFAULT_CONFIG, 'a', { expectedVersion: 1 })).toBe(2)
  })

  it('rejects person_level_views: true with a ZodError and inserts nothing', async () => {
    const bad = { ...DEFAULT_CONFIG, person_level_views: true } as unknown as AppConfig
    const err = await saveConfigVersion(db, bad, 'a').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ZodError)
    expect(await db.select().from(configVersions)).toHaveLength(0)
    expect(await db.select().from(eventLog)).toHaveLength(0)
  })

  it('serialises concurrent saves into contiguous versions', async () => {
    const versions = await Promise.all(
      Array.from({ length: 5 }, () => saveConfigVersion(db, DEFAULT_CONFIG, 'a')),
    )
    expect([...versions].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('works inside an outer transaction that already holds the lock', async () => {
    const v = await db.transaction(async (tx) => {
      await tx.execute(`select pg_advisory_xact_lock(hashtext('config_versions'))`)
      return saveConfigVersion(tx, DEFAULT_CONFIG, 'a')
    })
    expect(v).toBe(1)
  })
})
