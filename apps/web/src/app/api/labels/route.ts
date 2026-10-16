import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { ParamError } from '@/lib/queries/errors'
import { apiError, withApi } from '@/lib/queries/http'
import { LabelRequest, type LabelResponse } from './_lib/contract'
import { createLabel } from './_lib/labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withApi(
  async (req: Request) => {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      throw new ParamError([{ path: [], code: 'invalid_json', message: 'body must be JSON' }])
    }
    const parsed = LabelRequest.safeParse(raw)
    if (!parsed.success) {
      throw new ParamError(
        parsed.error.issues.map((i) => ({
          path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
          code: i.code,
          message: i.message,
        })),
      )
    }
    const session = await auth.api.getSession({ headers: req.headers })
    const actor = session?.user.email ?? 'unknown'
    const res = await createLabel(getDb().sql, parsed.data, actor)
    switch (res.kind) {
      case 'not_found':
        return apiError(404, 'Post not found')
      case 'bad_topic':
        return apiError(400, 'bad_request', [
          { path: ['topicSlug'], code: 'unknown_topic', message: 'unknown or dismissed topic' },
        ])
      case 'gold_complete':
        return apiError(409, 'Gold set complete')
      case 'ok': {
        const out: LabelResponse = { ok: true, classificationId: res.classificationId }
        return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
      }
    }
  },
  { cacheControl: 'no-store' },
)
