import { compileMatcher, type TermsConfig } from '@jio/core'
import { getLatestConfig } from '@jio/db'
import { getDb } from '@/lib/db'
import { msToIso } from '@/lib/queries/ctx'
import { withApi } from '@/lib/queries/http'
import type { TermSample, TestTermsResponse } from '../_lib/contract'
import { readJson, validationFailed } from '../_lib/request'
import { validateTerms } from '../_lib/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CAP = 5000
const SAMPLES = 5

export const POST = withApi(
  async (req: Request) => {
    const body = await readJson(req)
    if (body instanceof Response) return body
    if (!body.terms || typeof body.terms !== 'object') {
      return validationFailed([{ path: 'terms', message: 'terms must be an object' }])
    }
    const v = validateTerms(body.terms as TermsConfig)
    if (!v.ok) return validationFailed(v.errors)

    const { db, sql } = getDb()
    const { config } = await getLatestConfig(db)
    const rows = await sql<{ text: string; source_key: string; ms: number }[]>`
      select text, source_key, extract(epoch from published_at) * 1000 as ms
      from posts
      where fetched_at >= now() - interval '24 hours'
      order by fetched_at desc
      limit ${CAP + 1}`
    const truncated = rows.length > CAP
    const posts = truncated ? rows.slice(0, CAP) : rows

    const current = compileMatcher(config.terms)
    const draft = compileMatcher(v.normalized)
    let matchedCurrent = 0
    let matchedDraft = 0
    const samples: TermSample[] = []
    for (const p of posts) {
      const c = current(p.text).relevant
      const d = draft(p.text).relevant
      if (c) matchedCurrent++
      if (d) matchedDraft++
      if (d && !c && samples.length < SAMPLES) {
        samples.push({
          text: p.text.slice(0, 200),
          sourceKey: p.source_key,
          publishedAt: msToIso(p.ms) ?? '',
        })
      }
    }
    const res: TestTermsResponse = {
      total: posts.length,
      matchedCurrent,
      matchedDraft,
      truncated,
      samples,
    }
    return res
  },
  { cacheControl: 'no-store' },
)
