// The summaries job body: a two-line summary for each active seed topic and each live emerging
// candidate with enough items in the last 24h. A failure on one topic is logged and skipped.
import type { Lang, Sentiment } from '@jio/core'
import type { PipelineDeps, PipelineHandle } from './deps'
import type { SummaryPost } from './summarizer'

export const SUMMARY_TOP_POSTS = 15
export const EMERGING_MIN_ITEMS_24H = 3

export type SummariesResult = { summarized: number; failed: number; skipped: number }

type TopicRow = {
  id: string
  name: string
  kind: string
  items: number
  pos: number
  neu: number
  neg: number
}

export async function runSummaries(
  h: PipelineHandle,
  deps: Pick<PipelineDeps, 'summarizer' | 'log'>,
  now: Date = new Date(),
): Promise<SummariesResult> {
  const from = new Date(now.getTime() - 24 * 3_600_000).toISOString()
  const to = now.toISOString()
  const topics = await h.sql<TopicRow[]>`
    select t.id, t.name, t.kind,
           count(p.id)::int as items,
           (count(p.id) filter (where ec.sentiment = 'positive'))::int as pos,
           (count(p.id) filter (where ec.sentiment = 'neutral'))::int as neu,
           (count(p.id) filter (where ec.sentiment = 'negative'))::int as neg
    from topics t
    left join effective_classifications ec on ec.topic_id = t.id
    left join posts p on p.id = ec.post_id
      and p.published_at > ${from}::timestamptz and p.published_at <= ${to}::timestamptz
    where (t.kind = 'seed' and t.status = 'active')
       or (t.kind = 'emerging' and t.slug <> 'emerging' and t.status <> 'dismissed')
    group by t.id, t.name, t.kind
    order by t.kind, t.name`

  const result: SummariesResult = { summarized: 0, failed: 0, skipped: 0 }
  for (const t of topics) {
    const min = t.kind === 'emerging' ? EMERGING_MIN_ITEMS_24H : 1
    if (t.items < min) {
      result.skipped++
      continue
    }
    try {
      const rows = await h.sql<
        { text: string; gloss_en: string | null; sentiment: Sentiment; lang: Lang | null }[]
      >`
        select p.text, ec.gloss_en, ec.sentiment, p.lang
        from effective_classifications ec
        join posts p on p.id = ec.post_id
        where ec.topic_id = ${t.id}
          and p.published_at > ${from}::timestamptz and p.published_at <= ${to}::timestamptz
        order by p.reach_score desc nulls last, p.published_at desc, p.id
        limit ${SUMMARY_TOP_POSTS}`
      const posts: SummaryPost[] = rows.map((r) => ({
        text: r.text,
        glossEn: r.gloss_en,
        sentiment: r.sentiment,
        lang: r.lang ?? undefined,
      }))
      const [line1, line2] = await deps.summarizer.summarize({ name: t.name }, posts, {
        items: t.items,
        pos: t.pos,
        neu: t.neu,
        neg: t.neg,
      })
      await h.sql`
        update topics set summary_2line = ${`${line1}\n${line2}`}, summary_at = ${to}::timestamptz
        where id = ${t.id}`
      result.summarized++
    } catch (err) {
      result.failed++
      deps.log.warn(
        { topicId: t.id, err: err instanceof Error ? err.message : String(err) },
        'topic summary failed; skipped',
      )
    }
  }
  deps.log.info({ ...result, model: deps.summarizer.model }, 'summaries run')
  return result
}
