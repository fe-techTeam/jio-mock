// GET /api/topics/:slug/timeline reader: topic meta, 168 IST-hour points, 7 days of market
// series (last value per IST hour), and 24h splits by source and by entity.
import {
  ENTITY_KEYS,
  MARKET_SERIES,
  type EntityKey,
  type HourPoint,
  type MarketSeries,
  type MarketSeriesPoints,
  type SourceKey,
  type TimelineResponse,
  type TimelineTopic,
  type TopicKind,
} from '@jio/core'
import { getLatestConfig } from '@jio/db'
import { iso, msToIso, type ReadCtx, type SliceFilter } from './ctx'
import { splitShown } from './ranking'
import { HOUR_MS, IST_HOUR_ORIGIN, istHours, windowRanges } from './window'

const TIMELINE_HOURS = 168
const ALL: SliceFilter = { entity: 'all', lane: 'all' }

type MetaRow = {
  id: string
  slug: string
  name: string
  kind: TopicKind
  summary_2line: string | null
  summary_at_ms: number | null
  items24h: number
  last_item_ms: number | null
}

async function loadMeta(
  ctx: ReadCtx,
  slug: string,
  f: SliceFilter,
): Promise<{ id: string; topic: TimelineTopic } | null> {
  const { sql, now } = ctx
  const { cur } = windowRanges(now)
  const [row] = await sql<MetaRow[]>`
    select t.id, t.slug, t.name, t.kind, t.summary_2line,
           (extract(epoch from t.summary_at) * 1000)::float8 as summary_at_ms,
           (select coalesce(sum(s.items), 0)::int from topic_stats_15m s
             where s.topic_id = t.id and s.entity = ${f.entity} and s.lane = ${f.lane}
               and s.bucket_start >= ${iso(cur.from)}::timestamptz
               and s.bucket_start < ${iso(cur.to)}::timestamptz) as items24h,
           (select (extract(epoch from max(p.published_at)) * 1000)::float8
              from effective_classifications ec
              join posts p on p.id = ec.post_id
             where ec.topic_id = t.id
               and p.published_at <= ${iso(now)}::timestamptz
               and (${f.lane}::text = 'all' or p.lane = ${f.lane}::text)
               and (${f.entity}::text = 'all' or ${f.entity}::text = any(ec.entities))
           ) as last_item_ms
    from topics t
    where t.slug = ${slug}`
  if (!row) return null
  return {
    id: row.id,
    topic: {
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      summary2line: row.summary_2line,
      summaryAt: msToIso(row.summary_at_ms),
      items24h: row.items24h,
      lastItemAt: msToIso(row.last_item_ms),
    },
  }
}

/** The topic header for /topics/[slug], or null for an unknown slug. */
export async function getTopicMeta(
  ctx: ReadCtx,
  slug: string,
  f: SliceFilter = ALL,
): Promise<TimelineTopic | null> {
  return (await loadMeta(ctx, slug, f))?.topic ?? null
}

export async function getTimeline(
  ctx: ReadCtx,
  slug: string,
  f: SliceFilter,
): Promise<TimelineResponse | null> {
  const meta = await loadMeta(ctx, slug, f)
  if (!meta) return null
  const { sql, now } = ctx
  const topicId = meta.id
  const { cur } = windowRanges(now)
  const hours = istHours(now, TIMELINE_HOURS)
  const from = hours[0]!
  const to = new Date(hours[hours.length - 1]!.getTime() + HOUR_MS)

  const [seriesRows, marketRows, sourceRows, entityRows, latest] = await Promise.all([
    sql<{ h_ms: number; items: number; pos: number; neu: number; neg: number; low_conf: number }[]>`
      select (extract(epoch from date_bin('1 hour', s.bucket_start, ${IST_HOUR_ORIGIN}::timestamptz)) * 1000)::float8 as h_ms,
             sum(s.items)::int as items, sum(s.pos)::int as pos, sum(s.neu)::int as neu,
             sum(s.neg)::int as neg, sum(s.low_conf)::int as low_conf
      from topic_stats_15m s
      where s.topic_id = ${topicId} and s.entity = ${f.entity} and s.lane = ${f.lane}
        and s.bucket_start >= ${iso(from)}::timestamptz
        and s.bucket_start < ${iso(to)}::timestamptz
      group by 1`,
    sql<{ series: MarketSeries; h_ms: number; value: number }[]>`
      select distinct on (x.series, x.h) x.series,
             (extract(epoch from x.h) * 1000)::float8 as h_ms, x.value
      from (
        select m.series, m.value, m.observed_at, m.fetched_at,
               date_bin('1 hour', m.observed_at, ${IST_HOUR_ORIGIN}::timestamptz) as h
        from market_points m
        where m.observed_at >= ${iso(from)}::timestamptz
          and m.observed_at <= ${iso(now)}::timestamptz
      ) x
      order by x.series, x.h, x.observed_at desc, x.fetched_at desc`,
    sql<{ source_key: SourceKey; items: number; pos: number; neu: number; neg: number }[]>`
      select p.source_key, count(*)::int as items,
             (count(*) filter (where ec.sentiment = 'positive'))::int as pos,
             (count(*) filter (where ec.sentiment = 'neutral'))::int as neu,
             (count(*) filter (where ec.sentiment = 'negative'))::int as neg
      from posts p
      join effective_classifications ec on ec.post_id = p.id
      where ec.topic_id = ${topicId}
        and p.published_at >= ${iso(cur.from)}::timestamptz
        and p.published_at < ${iso(cur.to)}::timestamptz
        and (${f.lane}::text = 'all' or p.lane = ${f.lane}::text)
        and (${f.entity}::text = 'all' or ${f.entity}::text = any(ec.entities))
      group by p.source_key
      order by items desc, p.source_key`,
    sql<{ entity: EntityKey; items: number; pos: number; neu: number; neg: number }[]>`
      select s.entity, sum(s.items)::int as items, sum(s.pos)::int as pos,
             sum(s.neu)::int as neu, sum(s.neg)::int as neg
      from topic_stats_15m s
      where s.topic_id = ${topicId} and s.lane = ${f.lane} and s.entity <> 'all'
        and s.bucket_start >= ${iso(cur.from)}::timestamptz
        and s.bucket_start < ${iso(cur.to)}::timestamptz
      group by s.entity`,
    getLatestConfig(ctx.db),
  ])

  const { config } = latest
  const minSplit = config.min_items_for_split

  const byHour = new Map(seriesRows.map((r) => [Number(r.h_ms), r]))
  const series: HourPoint[] = hours.map((h) => {
    const r = byHour.get(h.getTime())
    return {
      hourStart: iso(h),
      items: r?.items ?? 0,
      pos: r?.pos ?? 0,
      neu: r?.neu ?? 0,
      neg: r?.neg ?? 0,
      lowConf: r?.low_conf ?? 0,
    }
  })

  const market = Object.fromEntries(
    MARKET_SERIES.map((s) => [s, [] as { t: string; v: number }[]]),
  ) as MarketSeriesPoints
  for (const r of marketRows) {
    market[r.series]?.push({ t: msToIso(r.h_ms)!, v: r.value })
  }

  const bySource = sourceRows.map((r) => ({
    sourceKey: r.source_key,
    coverageLabel: config.sources[r.source_key]?.coverage_label ?? 'full_search',
    items: r.items,
    pos: r.pos,
    neu: r.neu,
    neg: r.neg,
    splitShown: splitShown(r.items, minSplit),
  }))

  const entityMap = new Map(entityRows.map((r) => [r.entity, r]))
  const byEntity = ENTITY_KEYS.map((entity) => {
    const r = entityMap.get(entity)
    const items = r?.items ?? 0
    return {
      entity,
      items,
      pos: r?.pos ?? 0,
      neu: r?.neu ?? 0,
      neg: r?.neg ?? 0,
      splitShown: splitShown(items, minSplit),
    }
  })

  return {
    topic: meta.topic,
    asOf: iso(now),
    lane: f.lane,
    minItemsForSplit: minSplit,
    series,
    market,
    bySource,
    byEntity,
  }
}
