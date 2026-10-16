// Builds the SourcesResponse from an explicit allowlist of fields (never spreads SourceConfig,
// so no creds_ref value can leak).
import { getLatestConfig, sourceHealth } from '@jio/db'
import type { SourceKey } from '@jio/core'
import type { ReadCtx } from '@/lib/queries/ctx'
import { SOURCE_NAMES, SOURCE_ORDER, type SourceRow, type SourcesResponse } from './contract'
import { lastRunModes, youtubeQuota } from './queries'
import { deriveStatus, effectiveIntervalMin, nextRunAt, resolveMode, xModeLabel } from './status'

const SAMPLED: ReadonlySet<SourceKey> = new Set(['apify_instagram', 'apify_linkedin'])
export const X_TOKEN_NAME = 'X_BEARER_TOKEN'

export async function buildSourcesResponse(
  ctx: ReadCtx,
  env: Record<string, string | undefined>,
): Promise<SourcesResponse> {
  const [latest, health, modes, quota] = await Promise.all([
    getLatestConfig(ctx.db),
    sourceHealth(ctx.db, ctx.now),
    lastRunModes(ctx),
    youtubeQuota(ctx),
  ])
  const byKey = new Map(health.map((h) => [h.sourceKey, h]))

  const sources: SourceRow[] = SOURCE_ORDER.map((key) => {
    const cfg = latest.config.sources[key]
    const h = byKey.get(key)
    const configCreds = Object.entries(cfg.creds_ref ?? {})
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k)
    const resolved = resolveMode(key, env, configCreds)
    const eff = effectiveIntervalMin(key, cfg, ctx.now)
    const lastRunAt = h?.lastRunAt ?? null
    const lastSuccessAt = h?.lastSuccessAt ?? null
    const consecutiveFailures = h?.consecutiveFailures ?? 0
    const next = nextRunAt({ enabled: cfg.enabled, lastRunAt, effectiveIntervalMin: eff })
    return {
      key,
      name: SOURCE_NAMES[key],
      lane: cfg.lane,
      enabled: cfg.enabled,
      status: deriveStatus({
        enabled: cfg.enabled,
        lastRunAt,
        lastSuccessAt,
        consecutiveFailures,
        effectiveIntervalMin: eff,
        now: ctx.now,
      }),
      mode: modes[key] ?? resolved.mode,
      missingCreds: resolved.missingCreds,
      coverageLabel: SAMPLED.has(key) ? 'sampled' : cfg.coverage_label,
      intervalMin: cfg.interval_min,
      marketHoursIntervalMin: key.startsWith('portal_') ? cfg.market_hours_interval_min : null,
      effectiveIntervalMin: eff,
      lastSuccessAt: lastSuccessAt?.toISOString() ?? null,
      lastErrorAt: h?.lastErrorAt?.toISOString() ?? null,
      lastError: h?.lastError ?? null,
      nextRunAt: next?.toISOString() ?? null,
      consecutiveFailures,
      items24h: h?.items24h ?? 0,
      spendTodayUsd: h?.spendTodayUsd ?? 0,
    }
  })

  const ages = sources
    .filter((s) => s.enabled && s.lastSuccessAt)
    .map((s) => Math.floor((ctx.now.getTime() - Date.parse(s.lastSuccessAt!)) / 60_000))
  const xCfg = latest.config.sources.x_api
  const xRow = sources.find((s) => s.key === 'x_api')!

  return {
    asOf: ctx.now.toISOString(),
    configVersion: latest.version,
    oldestSuccessAgeMin: ages.length ? Math.max(0, ...ages) : null,
    spendTodayUsd: health.reduce((a, h) => a + h.spendTodayUsd, 0),
    spend7dUsd: health.reduce((a, h) => a + h.spend7dUsd, 0),
    sources,
    x: {
      tier: xCfg.x_tier,
      rateLimits: { ...xCfg.rate_limits },
      credsSet: Boolean(xCfg.creds_ref?.[X_TOKEN_NAME]),
      modeLabel: xModeLabel(xRow.enabled, xRow.mode),
    },
    youtubeQuota: quota,
  }
}
