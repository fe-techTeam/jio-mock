import { readCtx } from '@/lib/queries/ctx'
import { getEvidence } from '@/lib/queries/evidence'
import { withApi } from '@/lib/queries/http'
import { EvidenceParams, parseParams } from '@/lib/queries/params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Never cached: new pages and relabels must show at once.
export const GET = withApi(
  async (req: Request) => {
    const p = parseParams(EvidenceParams, new URL(req.url).searchParams)
    return getEvidence(readCtx(), p)
  },
  { cacheControl: 'no-store' },
)
