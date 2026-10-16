// Validation for PATCH /api/sources. Every rule returns a field-path issue for inline display.
import { X_TIERS, type AppConfig, type SourceKey } from '@jio/core'
import { ParamError, type ParamIssue } from '@/lib/queries/errors'
import { SOURCE_ORDER, SourcesPatch, YOUTUBE_DAILY_QUOTA } from './contract'
import { YOUTUBE_SEARCH_UNITS, minYoutubeIntervalMin } from './status'

export const TOKEN_MIN = 20
export const TOKEN_MAX = 512

export function parsePatch(body: unknown): SourcesPatch {
  const r = SourcesPatch.safeParse(body)
  if (r.success) return r.data
  throw new ParamError(
    r.error.issues.map((i) => ({
      path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
      code: i.code,
      message: i.message,
    })),
  )
}

const isKey = (k: string): k is SourceKey => (SOURCE_ORDER as readonly string[]).includes(k)

export function normalizeToken(t: string): string {
  return t.trim()
}

export function validatePatch(patch: SourcesPatch, current: AppConfig): ParamIssue[] {
  const issues: ParamIssue[] = []
  const add = (path: (string | number)[], message: string, code = 'invalid_value') =>
    issues.push({ path, code, message })

  const entries = Object.entries(patch.sources ?? {})
  if (entries.length === 0 && !patch.x) add(['body'], 'Nothing to change', 'empty')

  for (const [key, p] of entries) {
    if (!isKey(key)) {
      add(['sources', key], 'Unknown source')
      continue
    }
    const cur = current.sources[key]
    const interval = p.interval_min ?? cur.interval_min
    if (p.interval_min !== undefined) {
      const v = p.interval_min
      if (!Number.isInteger(v) || v < 1 || v > 1440) {
        add(['sources', key, 'interval_min'], 'Must be a whole number from 1 to 1440 minutes')
      } else if (key === 'youtube' && v < minYoutubeIntervalMin()) {
        add(
          ['sources', key, 'interval_min'],
          `At least ${minYoutubeIntervalMin()} minutes: each search costs ${YOUTUBE_SEARCH_UNITS} units of the ${YOUTUBE_DAILY_QUOTA.toLocaleString('en-US')}-unit daily quota`,
        )
      }
    }
    if (p.market_hours_interval_min !== undefined) {
      const v = p.market_hours_interval_min
      const path = ['sources', key, 'market_hours_interval_min']
      if (!key.startsWith('portal_')) {
        add(path, 'Only portal sources have a market-hours interval')
      } else if (!Number.isInteger(v) || v < 1 || v > 1440) {
        add(path, 'Must be a whole number from 1 to 1440 minutes')
      } else if (v > interval) {
        add(path, 'Must not be longer than the regular interval')
      }
    }
  }

  const x = patch.x
  if (x) {
    if (x.x_tier != null && !(X_TIERS as readonly string[]).includes(x.x_tier)) {
      add(['x', 'x_tier'], 'Unknown tier')
    }
    for (const [k, v] of Object.entries(x.rate_limits ?? {})) {
      if (!Number.isFinite(v) || v < 0) add(['x', 'rate_limits', k], 'Must be a number, 0 or more')
    }
    if (typeof x.bearerToken === 'string') {
      const t = normalizeToken(x.bearerToken)
      if (t.length < TOKEN_MIN || t.length > TOKEN_MAX) {
        add(['x', 'bearerToken'], `Token must be ${TOKEN_MIN} to ${TOKEN_MAX} characters`)
      } else if (/\s/.test(t)) {
        add(['x', 'bearerToken'], 'Token must not contain spaces')
      }
    }
  }
  return issues
}
