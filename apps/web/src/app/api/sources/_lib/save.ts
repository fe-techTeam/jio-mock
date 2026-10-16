// PATCH /api/sources: merge into the latest config and save a new version.
// Concurrency: saveConfigVersion takes pg_advisory_xact_lock(hashtext('config_versions')) and
// compares expectedVersion inside its transaction, so a concurrent edit becomes a conflict.
import { ConfigConflictError, getLatestConfig, saveConfigVersion } from '@jio/db'
import type { AppConfig, SourceKey, XTier } from '@jio/core'
import { CredentialKeyError, encryptSecret } from '@/lib/crypto'
import type { ReadCtx } from '@/lib/queries/ctx'
import type { SourcesPatch } from './contract'
import { X_TOKEN_NAME } from './build'
import { normalizeToken } from './validate'

export const CONFLICT_MESSAGE = 'Config changed since you opened it, reload'
export const KEY_UNAVAILABLE_MESSAGE = 'Credential storage unavailable'

export type SaveResult =
  { ok: true; version: number } | { ok: false; status: 409 | 503; error: string }

/** Pure merge. Throws CredentialKeyError when a token is set without a usable key. */
export function applyPatch(config: AppConfig, patch: SourcesPatch): AppConfig {
  const next = structuredClone(config)
  for (const [key, p] of Object.entries(patch.sources ?? {})) {
    const s = next.sources[key as SourceKey]
    if (p.enabled !== undefined) s.enabled = p.enabled
    if (p.interval_min !== undefined) s.interval_min = p.interval_min
    if (p.market_hours_interval_min !== undefined) {
      s.market_hours_interval_min = p.market_hours_interval_min
    }
  }
  const x = patch.x
  if (x) {
    const s = next.sources.x_api
    if (x.x_tier !== undefined) s.x_tier = x.x_tier as XTier | null
    if (x.rate_limits !== undefined) s.rate_limits = { ...s.rate_limits, ...x.rate_limits }
    if (x.bearerToken === null) {
      const rest = { ...(s.creds_ref ?? {}) }
      delete rest[X_TOKEN_NAME]
      s.creds_ref = Object.keys(rest).length ? rest : null
    } else if (typeof x.bearerToken === 'string') {
      s.creds_ref = {
        ...(s.creds_ref ?? {}),
        [X_TOKEN_NAME]: encryptSecret(normalizeToken(x.bearerToken)),
      }
    }
  }
  return next
}

export async function savePatch(ctx: ReadCtx, patch: SourcesPatch): Promise<SaveResult> {
  const latest = await getLatestConfig(ctx.db)
  if (latest.version !== patch.baseVersion) {
    return { ok: false, status: 409, error: CONFLICT_MESSAGE }
  }
  let next: AppConfig
  try {
    next = applyPatch(latest.config, patch)
  } catch (err) {
    if (err instanceof CredentialKeyError) {
      console.error('credential storage unavailable:', err.message)
      return { ok: false, status: 503, error: KEY_UNAVAILABLE_MESSAGE }
    }
    throw err
  }
  try {
    const version = await saveConfigVersion(ctx.db, next, 'operator', {
      expectedVersion: patch.baseVersion,
    })
    return { ok: true, version }
  } catch (err) {
    if (err instanceof ConfigConflictError) {
      return { ok: false, status: 409, error: CONFLICT_MESSAGE }
    }
    throw err
  }
}
