import { getBrief } from '@/lib/queries/brief'
import { memo } from '@/lib/queries/cache'
import { readCtx } from '@/lib/queries/ctx'
import { withApi } from '@/lib/queries/http'
import { BriefParams, parseParams } from '@/lib/queries/params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 15_000

export const GET = withApi(async (req: Request) => {
  const f = parseParams(BriefParams, new URL(req.url).searchParams)
  return memo(`brief:${f.entity}:${f.lane}`, TTL_MS, () => getBrief(readCtx(), f))
})
