import { getDb } from '@/lib/db'
import { withApi } from '@/lib/queries/http'
import { parseParams } from '@/lib/queries/params'
import { QueueParams, type QueueResponse } from '../_lib/contract'
import { nextQueueItem } from '../_lib/labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(
  async (req: Request): Promise<QueueResponse> => {
    const p = parseParams(QueueParams, new URL(req.url).searchParams)
    return nextQueueItem(getDb().sql, p.exclude)
  },
  { cacheControl: 'no-store' },
)
