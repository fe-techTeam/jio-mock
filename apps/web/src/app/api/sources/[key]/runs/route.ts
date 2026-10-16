import { recentFetchRuns } from '@jio/db'
import { SOURCE_KEYS, type SourceKey } from '@jio/core'
import { readCtx } from '@/lib/queries/ctx'
import { ParamError } from '@/lib/queries/errors'
import { withApi } from '@/lib/queries/http'
import type { RunRow } from '../../_lib/contract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(
  async (_req: Request, { params }: { params: Promise<{ key: string }> }) => {
    const { key } = await params
    if (!(SOURCE_KEYS as readonly string[]).includes(key)) {
      throw new ParamError([{ path: ['key'], code: 'invalid_value', message: 'Unknown source' }])
    }
    const rows = await recentFetchRuns(readCtx().db, key as SourceKey, 10)
    return rows.map((r): RunRow => ({
      at: r.at.toISOString(),
      status: r.status,
      durationMs: r.durationMs,
      itemsNew: r.itemsNew,
      costUsd: r.costUsd,
      error: r.error,
    }))
  },
  { cacheControl: 'no-store' },
)
