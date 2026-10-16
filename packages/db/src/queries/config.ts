import { desc, max, sql } from 'drizzle-orm'
import { AppConfig, DEFAULT_CONFIG, type AppConfigInput } from '@jio/core'
import { configVersions } from '../schema'
import { logEvent, type DbLike } from './events'

/** Thrown when `expectedVersion` is not the latest saved version; nothing was written. */
export class ConfigConflictError extends Error {
  readonly latestVersion: number
  readonly expectedVersion: number
  constructor(latestVersion: number, expectedVersion: number) {
    super(`Config version conflict: expected ${expectedVersion}, latest is ${latestVersion}`)
    this.name = 'ConfigConflictError'
    this.latestVersion = latestVersion
    this.expectedVersion = expectedVersion
  }
}

/** Thrown when the stored config row no longer parses with AppConfig. */
export class ConfigParseError extends Error {
  readonly version: number
  constructor(version: number, cause: unknown) {
    super(`Stored config version ${version} does not parse`, { cause })
    this.name = 'ConfigParseError'
    this.version = version
  }
}

export type LatestConfig = { version: number; savedAt: Date | null; config: AppConfig }

/** The newest config version, parsed (defaults filled). Version 0 means none saved yet. */
export async function getLatestConfig(db: DbLike): Promise<LatestConfig> {
  const [row] = await db
    .select()
    .from(configVersions)
    .orderBy(desc(configVersions.version))
    .limit(1)
  if (!row) return { version: 0, savedAt: null, config: DEFAULT_CONFIG }
  const parsed = AppConfig.safeParse(row.config)
  if (!parsed.success) throw new ConfigParseError(row.version, parsed.error)
  return { version: row.version, savedAt: row.savedAt, config: parsed.data }
}

/**
 * Validates and saves `config` as latest + 1 and logs a config_change event, all in one
 * transaction under `pg_advisory_xact_lock(hashtext('config_versions'))`. The lock is
 * re-entrant, so a caller may already hold it in an outer transaction. Throws
 * ConfigConflictError on a stale `expectedVersion` and ZodError on an invalid config.
 */
export async function saveConfigVersion(
  db: DbLike,
  config: AppConfigInput,
  actor: string,
  opts: { expectedVersion?: number } = {},
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('config_versions'))`)
    const [latestRow] = await tx.select({ v: max(configVersions.version) }).from(configVersions)
    const latest = latestRow?.v ?? 0
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== latest) {
      throw new ConfigConflictError(latest, opts.expectedVersion)
    }
    const parsed = AppConfig.parse(config)
    const version = latest + 1
    await tx.insert(configVersions).values({ version, actor, config: parsed })
    await logEvent(tx, {
      kind: 'config_change',
      actor,
      detail: { version, previousVersion: latest === 0 ? null : latest },
    })
    return version
  })
}
