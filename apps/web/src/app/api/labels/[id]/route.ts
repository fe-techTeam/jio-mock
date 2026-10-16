import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { ParamError } from '@/lib/queries/errors'
import { apiError, withApi } from '@/lib/queries/http'
import { undoLabel } from '../_lib/labels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Undo: deletes a correction or gold row created in the last 10 minutes.
export const DELETE = withApi(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params
    const parsed = z.uuid().safeParse(id)
    if (!parsed.success) {
      throw new ParamError([{ path: ['id'], code: 'invalid_format', message: 'id must be a uuid' }])
    }
    const session = await auth.api.getSession({ headers: req.headers })
    const res = await undoLabel(getDb().sql, parsed.data, session?.user.email ?? 'unknown')
    if (res.kind === 'not_found') return apiError(404, 'Label not found')
    if (res.kind === 'not_undoable') return apiError(409, 'Only recent corrections can be undone')
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  },
  { cacheControl: 'no-store' },
)
