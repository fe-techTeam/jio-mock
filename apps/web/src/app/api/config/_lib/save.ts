import { AppConfig } from '@jio/core'
import { ConfigConflictError, getLatestConfig, saveConfigVersion, type Db } from '@jio/db'
import type { ConfigPatch, ConfigResponse } from './contract'

export class StaleConfigError extends Error {
  constructor() {
    super('Config changed since you opened it, reload')
    this.name = 'StaleConfigError'
  }
}

export function toConfigResponse(
  latest: Awaited<ReturnType<typeof getLatestConfig>>,
): ConfigResponse {
  const c = latest.config
  return {
    version: latest.version,
    savedAt: latest.savedAt ? new Date(latest.savedAt).toISOString() : null,
    terms: c.terms,
    retentionDays: c.retention_days,
    minItemsForSplit: c.min_items_for_split,
    activeMinItems24h: c.active_min_items_24h,
    personLevelViews: false,
  }
}

/**
 * Merges only the supplied sections onto the latest config (sources and creds stay as they are),
 * forces person_level_views false and saves a new version. saveConfigVersion re-checks
 * `expectedVersion` under its advisory lock (pg_advisory_xact_lock(hashtext('config_versions'))),
 * so a concurrent save cannot slip between this merge and the insert.
 * `terms` and the numbers must be validated by the caller.
 */
export async function saveConfigPatch(db: Db, patch: ConfigPatch, actor: string): Promise<number> {
  const latest = await getLatestConfig(db)
  if (latest.version !== patch.baseVersion) throw new StaleConfigError()
  const next = structuredClone(latest.config)
  if (patch.terms) next.terms = patch.terms
  if (patch.retentionDays) next.retention_days = patch.retentionDays
  if (patch.minItemsForSplit !== undefined) next.min_items_for_split = patch.minItemsForSplit
  if (patch.activeMinItems24h !== undefined) next.active_min_items_24h = patch.activeMinItems24h
  next.person_level_views = false
  try {
    return await saveConfigVersion(db, AppConfig.parse(next), actor, {
      expectedVersion: patch.baseVersion,
    })
  } catch (err) {
    if (err instanceof ConfigConflictError) throw new StaleConfigError()
    throw err
  }
}
