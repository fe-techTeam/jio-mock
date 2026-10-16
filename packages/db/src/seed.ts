import { DEFAULT_CONFIG } from '@jio/core'
import { ConfigConflictError, getLatestConfig, saveConfigVersion } from './queries/config'
import type { DbLike } from './queries/events'
import { upsertSeedTopics } from './queries/topics'

export type SeedResult = { configVersion: number; configCreated: boolean; topicsInserted: number }

/**
 * Idempotent base data: config version 1 from DEFAULT_CONFIG (actor 'seed') when no config
 * exists yet, then the 12 seed topics (existing slugs, and their edits, are left alone).
 */
export async function seedBase(db: DbLike): Promise<SeedResult> {
  let { version } = await getLatestConfig(db)
  let configCreated = false
  if (version === 0) {
    try {
      version = await saveConfigVersion(db, DEFAULT_CONFIG, 'seed', { expectedVersion: 0 })
      configCreated = true
    } catch (e) {
      if (!(e instanceof ConfigConflictError)) throw e
      version = e.latestVersion // a concurrent seed won the race
    }
  }
  const topicsInserted = await upsertSeedTopics(db)
  return { configVersion: version, configCreated, topicsInserted }
}
