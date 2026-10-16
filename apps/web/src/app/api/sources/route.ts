import { apiError, withApi } from '@/lib/queries/http'
import { readCtx } from '@/lib/queries/ctx'
import { ParamError } from '@/lib/queries/errors'
import { buildSourcesResponse } from './_lib/build'
import { savePatch } from './_lib/save'
import { parsePatch, validatePatch } from './_lib/validate'
import { getLatestConfig } from '@jio/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { cacheControl: 'no-store' }

export const GET = withApi(async () => buildSourcesResponse(readCtx(), process.env), NO_STORE)

export const PATCH = withApi(async (req: Request) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    throw new ParamError([{ path: ['body'], code: 'invalid_json', message: 'Body must be JSON' }])
  }
  const patch = parsePatch(body)
  const ctx = readCtx()
  const issues = validatePatch(patch, (await getLatestConfig(ctx.db)).config)
  if (issues.length) throw new ParamError(issues)

  const saved = await savePatch(ctx, patch)
  if (!saved.ok) return apiError(saved.status, saved.error)
  return buildSourcesResponse(ctx, process.env)
}, NO_STORE)
