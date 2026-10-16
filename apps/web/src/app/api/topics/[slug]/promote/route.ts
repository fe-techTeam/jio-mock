import { z } from 'zod'
import { getDb } from '@/lib/db'
import { apiError, withApi } from '@/lib/queries/http'
import { actorOf } from '../../../config/_lib/request'
import { HttpError, applyPromotion } from '../../../config/_lib/topics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('promote'),
    name: z.string().optional(),
    description: z.string().optional(),
  }),
  z.object({ action: z.literal('merge'), intoSlug: z.string().min(1).max(120) }),
  z.object({ action: z.literal('dismiss') }),
])

export const POST = withApi(
  async (req: Request, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params
    let json: unknown
    try {
      json = await req.json()
    } catch {
      return apiError(400, 'bad_request', [{ path: [], message: 'Expected a JSON body' }])
    }
    const parsed = Body.safeParse(json)
    if (!parsed.success) return apiError(400, 'bad_request', parsed.error.issues)
    try {
      return await applyPromotion(getDb().sql, slug, parsed.data, await actorOf(req))
    } catch (err) {
      if (err instanceof HttpError) return apiError(err.status, err.message)
      throw err
    }
  },
  { cacheControl: 'no-store' },
)
