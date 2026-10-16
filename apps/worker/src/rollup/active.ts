// Active/dormant status for seeded topics: active when the topic had at least `minItems24h` items
// (entity 'all', lane 'all') in the 15-minute buckets starting in (now - 24h, now]. Emerging,
// unclassified and dismissed rows are never touched here.
import type { Sql } from '../triage/repo'

/** Fallback when the config has no active_min_items_24h (it does as of 01-01). */
export const ACTIVE_MIN_ITEMS_24H = 10

export type TopicStatusCounts = { active: number; dormant: number; changed: number }

export async function refreshTopicStatus(
  h: { sql: Sql },
  now: Date,
  minItems24h: number = ACTIVE_MIN_ITEMS_24H,
): Promise<TopicStatusCounts> {
  const from = new Date(now.getTime() - 24 * 3_600_000)
  const rows = await h.sql<{ status: string; changed: boolean }[]>`
    with counts as (
      select t.id, t.status as old_status,
             case when coalesce(sum(s.items), 0) >= ${minItems24h} then 'active' else 'dormant' end
               as new_status
      from topics t
      left join topic_stats_15m s
        on s.topic_id = t.id and s.entity = 'all' and s.lane = 'all'
       and s.bucket_start > ${from.toISOString()}::timestamptz
       and s.bucket_start <= ${now.toISOString()}::timestamptz
      where t.kind = 'seed' and t.status <> 'dismissed'
      group by t.id, t.status
    ),
    upd as (
      update topics t set status = c.new_status
      from counts c
      where t.id = c.id and t.status is distinct from c.new_status
      returning t.id
    )
    select c.new_status as status, (c.id in (select id from upd)) as changed from counts c`
  return {
    active: rows.filter((r) => r.status === 'active').length,
    dormant: rows.filter((r) => r.status === 'dormant').length,
    changed: rows.filter((r) => r.changed).length,
  }
}
