import { getLatestConfig } from '@jio/db'
import { getDb } from '@/lib/db'
import { apiError, withApi } from '@/lib/queries/http'
import type { ConfigPatch } from './_lib/contract'
import {
  PERSON_LEVEL_LOCKED,
  actorOf,
  hasPersonLevelKey,
  readJson,
  validationFailed,
} from './_lib/request'
import { StaleConfigError, saveConfigPatch, toConfigResponse } from './_lib/save'
import { validateRetention, validateTerms, validateThresholds } from './_lib/validate'
import type { TermsConfig } from '@jio/core'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(async () => toConfigResponse(await getLatestConfig(getDb().db)), {
  cacheControl: 'no-store',
})

export const PATCH = withApi(
  async (req: Request) => {
    const body = await readJson(req)
    if (body instanceof Response) return body
    if (hasPersonLevelKey(body)) return apiError(400, PERSON_LEVEL_LOCKED)
    if (!Number.isInteger(body.baseVersion)) {
      return validationFailed([{ path: 'baseVersion', message: 'baseVersion is required' }])
    }
    const patch: ConfigPatch = { baseVersion: body.baseVersion as number }
    const issues = []

    if (body.terms !== undefined) {
      if (!body.terms || typeof body.terms !== 'object') {
        issues.push({ path: 'terms', message: 'terms must be an object' })
      } else {
        const v = validateTerms(body.terms as TermsConfig)
        if (v.ok) patch.terms = v.normalized
        else issues.push(...v.errors)
      }
    }
    if (body.retentionDays !== undefined) {
      const r = body.retentionDays as ConfigPatch['retentionDays']
      const errs = validateRetention(r!)
      if (errs.length === 0) patch.retentionDays = r
      issues.push(...errs)
    }
    issues.push(...validateThresholds(body))
    if (body.minItemsForSplit !== undefined)
      patch.minItemsForSplit = body.minItemsForSplit as number
    if (body.activeMinItems24h !== undefined) {
      patch.activeMinItems24h = body.activeMinItems24h as number
    }
    if (issues.length > 0) return validationFailed(issues)

    const { db } = getDb()
    const { actor } = await actorOf(req)
    try {
      await saveConfigPatch(db, patch, actor)
    } catch (err) {
      if (err instanceof StaleConfigError) return apiError(409, err.message)
      throw err
    }
    return toConfigResponse(await getLatestConfig(db))
  },
  { cacheControl: 'no-store' },
)
