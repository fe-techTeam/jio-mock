import { getDb } from '@/lib/db'
import { apiError, withApi } from '@/lib/queries/http'
import { HttpError, listAudit } from '../_lib/topics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withApi(
  async (req: Request) => {
    try {
      return await listAudit(getDb().sql, new URL(req.url).searchParams.get('cursor'))
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.message)
      throw err
    }
  },
  { cacheControl: 'no-store' },
)
