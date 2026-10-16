// The src + fan CTEs shared by the rollup statements (index.ts) and the coordination helpers
// (coordination.ts): classified posts published in [from, to), bucketed to 15 minutes, fanned out
// to entity ('all' plus each effective entity) x lane ('all' plus the post's lane). A NULL
// reach_score counts as `unknown`. author_id never leaves the worker: callers aggregate it away.
import type { Sql } from '../triage/repo'

export function fanned(tx: Sql, from: Date, to: Date, unknown: number) {
  return tx`
      src as (
        select date_bin('15 minutes', p.published_at, timestamptz '2000-01-01 00:00:00+00')
                 as bucket_start,
               ec.topic_id, p.lane, ec.entities, ec.sentiment, ec.confidence,
               coalesce(p.reach_score, ${unknown}::real)::double precision as reach,
               p.author_id, p.coord_suspected
        from posts p
        join effective_classifications ec on ec.post_id = p.id
        where p.published_at >= ${from.toISOString()}::timestamptz
          and p.published_at < ${to.toISOString()}::timestamptz
      ),
      fan as (
        select s.bucket_start, s.topic_id, e.entity, l.lane, s.sentiment, s.confidence, s.reach,
               s.author_id, s.coord_suspected
        from src s
        cross join lateral (
          select 'all'::text as entity
          union
          select distinct x from unnest(s.entities) as x where x <> 'all'
        ) e
        cross join lateral (values ('all'::text), (s.lane)) as l(lane)
      )`
}
