import { memo } from '@/lib/queries/cache'
import { readCtx } from '@/lib/queries/ctx'
import { apiError, withApi } from '@/lib/queries/http'
import { ParamError, SLUG_RE, TimelineParams, parseParams } from '@/lib/queries/params'
import { getTimeline } from '@/lib/queries/timeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 15_000

export const GET = withApi(
  async (req: Request, { params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params
    if (!SLUG_RE.test(slug)) {
      throw new ParamError([{ path: ['slug'], code: 'invalid_format', message: 'Invalid slug' }])
    }
    const f = parseParams(TimelineParams, new URL(req.url).searchParams)
    const body = await memo(`timeline:${slug}:${f.entity}:${f.lane}`, TTL_MS, () =>
      getTimeline(readCtx(), slug, f),
    )
    return body ?? apiError(404, 'not_found')
  },
)
