import { z } from 'zod'
import type { EntityKey, Lang, Sentiment } from '@jio/core'
import { getDb } from '@/lib/db'
import { withApi } from '@/lib/queries/http'
import { parseParams } from '@/lib/queries/params'
import { computeAccuracy, type AccuracyResponse, type AccuracyRow } from './_lib/compute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TARGET = 200
/** The classifier's few-shot cap (03-02: up to 20 examples). */
const FEW_SHOT_MAX = 20

const Params = z.object({
  promptVersion: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[A-Za-z0-9._:@+-]{1,100}$/)
      .optional(),
  ),
})

type GoldRow = {
  post_id: string
  lang: Lang | null
  sentiment: Sentiment
  slug: string
  entities: EntityKey[] | null
}
type ModelRow = GoldRow & { prompt_version: string | null }

export const GET = withApi(
  async (req: Request): Promise<AccuracyResponse> => {
    const { promptVersion } = parseParams(Params, new URL(req.url).searchParams)
    const { sql } = getDb()

    const [newest] = await sql<{ prompt_version: string; at_ms: number }[]>`
      select prompt_version, extract(epoch from created_at) * 1000 as at_ms
      from classifications
      where origin = 'model' and prompt_version is not null
      order by created_at desc, id desc limit 1`
    const filter = promptVersion === 'latest' ? newest?.prompt_version : promptVersion

    const gold = await sql<GoldRow[]>`
      select distinct on (c.post_id) c.post_id, p.lang, c.sentiment, t.slug, c.entities
      from classifications c
      join posts p on p.id = c.post_id
      join topics t on t.id = c.topic_id
      where c.origin = 'gold'
      order by c.post_id, c.created_at desc, c.id desc`
    const model = await sql<ModelRow[]>`
      select distinct on (c.post_id) c.post_id, p.lang, c.sentiment, t.slug, c.entities,
             c.prompt_version
      from classifications c
      join posts p on p.id = c.post_id
      join topics t on t.id = c.topic_id
      where c.origin = 'model'
        and c.post_id in (select post_id from classifications where origin = 'gold')
      order by c.post_id, c.created_at desc, c.id desc`
    const sarcasm = await sql<{ post_id: string; sarcastic: boolean }[]>`
      select distinct on (detail->>'postId') detail->>'postId' as post_id,
             coalesce((detail->>'sarcastic')::boolean, false) as sarcastic
      from event_log
      where kind = 'relabel' and detail->>'origin' = 'gold' and detail ? 'classificationId'
        and coalesce((detail->>'undo')::boolean, false) = false
      order by detail->>'postId', id desc`
    const [corr] = await sql<{ n: number }[]>`
      select count(distinct post_id)::int as n from classifications where origin = 'correction'`

    const modelBy = new Map(model.map((m) => [m.post_id, m]))
    const sarcBy = new Map(sarcasm.map((s) => [s.post_id, s.sarcastic]))
    const rows: AccuracyRow[] = gold.map((g) => {
      const m = modelBy.get(g.post_id)
      return {
        postId: g.post_id,
        lang: g.lang ?? 'other',
        gold: { sentiment: g.sentiment, topicSlug: g.slug, entities: g.entities ?? [] },
        model: m
          ? {
              sentiment: m.sentiment,
              topicSlug: m.slug,
              entities: m.entities ?? [],
              promptVersion: m.prompt_version,
            }
          : null,
        sarcastic: sarcBy.get(g.post_id) ?? false,
      }
    })

    const computed = computeAccuracy(rows, { target: TARGET, promptVersion: filter })
    const count = corr?.n ?? 0
    return {
      ...computed,
      promptVersion: newest?.prompt_version ?? null,
      promptAt: newest ? new Date(Number(newest.at_ms)).toISOString() : null,
      corrections: { count, usedAsFewShot: Math.min(FEW_SHOT_MAX, count) },
    }
  },
  { cacheControl: 'no-store' },
)
