// GET /api/brief reader: KPIs, ranked active seed topics, Emerging/Unclassified counts, the
// market strip and per-source freshness. Counts come from topic_stats_15m (bucket-aligned 24h
// windows); unique authors come from posts x effective_classifications over the same window.
import {
  SOURCE_KEYS,
  isIndianMarketHours,
  type AppConfig,
  type BriefResponse,
  type FreshnessStatus,
  type MarketSeries,
  type MarketStripItem,
  type SourceFreshness,
  type SourceKey,
  type TopicKind,
  type TopicRow,
  type TopicStatus,
} from '@jio/core'
import { getLatestConfig, sourceHealth, type SourceHealthRow } from '@jio/db'
import { iso, minutesBetween, msToIso, type ReadCtx, type SliceFilter } from './ctx'
import {
  isActive,
  lowConfPct,
  rankScore,
  rankTopics,
  reachSplit,
  splitShown,
  trendOf,
} from './ranking'
import { IST_HOUR_ORIGIN, istHours, windowRanges } from './window'

const STALE_FAILURES = 3

type TopicSumRow = {
  id: string
  slug: string
  name: string
  kind: TopicKind
  status: TopicStatus
  summary_2line: string | null
  summary_at_ms: number | null
  items: number
  pos: number
  neu: number
  neg: number
  low_conf: number
  suspected: number
  items_prev: number
  reach_pos: number
  reach_neu: number
  reach_neg: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The interval in force now: the market-hours one during Indian market hours, when set. */
export function effectiveIntervalMin(src: AppConfig['sources'][SourceKey], now: Date): number {
  return isIndianMarketHours(now) && src.market_hours_interval_min != null
    ? src.market_hours_interval_min
    : src.interval_min
}

/** waiting = never succeeded; stale = older than 2 intervals or 3+ failures in a row. */
export function freshnessOf(
  key: SourceKey,
  config: AppConfig,
  health: SourceHealthRow | undefined,
  now: Date,
): SourceFreshness {
  const src = config.sources[key]
  const intervalMin = effectiveIntervalMin(src, now)
  const last = health?.lastSuccessAt ?? null
  const ageMin = last ? minutesBetween(now, last) : null
  const consecutiveFailures = health?.consecutiveFailures ?? 0
  let status: FreshnessStatus = 'ok'
  if (ageMin === null) status = 'waiting'
  else if (ageMin > 2 * intervalMin || consecutiveFailures >= STALE_FAILURES) status = 'stale'
  return {
    sourceKey: key,
    lane: src.lane,
    enabled: src.enabled,
    intervalMin,
    lastSuccessAt: last ? iso(last) : null,
    ageMin,
    consecutiveFailures,
    status,
  }
}

export async function getBrief(ctx: ReadCtx, f: SliceFilter): Promise<BriefResponse> {
  const { sql, now } = ctx
  const { cur, prev } = windowRanges(now)
  const hours = istHours(now, 24)
  const sparkFrom = hours[0]!

  const [topicRows, sparkRows, authorRows, marketRows, latest, health] = await Promise.all([
    sql<TopicSumRow[]>`
      select t.id, t.slug, t.name, t.kind, t.status, t.summary_2line,
             (extract(epoch from t.summary_at) * 1000)::float8 as summary_at_ms,
             coalesce(sum(s.items) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as items,
             coalesce(sum(s.pos) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as pos,
             coalesce(sum(s.neu) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as neu,
             coalesce(sum(s.neg) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as neg,
             coalesce(sum(s.low_conf) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as low_conf,
             coalesce(sum(s.suspected_coordinated) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::int as suspected,
             coalesce(sum(s.reach_pos) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::float8 as reach_pos,
             coalesce(sum(s.reach_neu) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::float8 as reach_neu,
             coalesce(sum(s.reach_neg) filter (where s.bucket_start >= ${iso(cur.from)}::timestamptz), 0)::float8 as reach_neg,
             coalesce(sum(s.items) filter (where s.bucket_start < ${iso(cur.from)}::timestamptz), 0)::int as items_prev
      from topics t
      left join topic_stats_15m s
        on s.topic_id = t.id and s.entity = ${f.entity} and s.lane = ${f.lane}
       and s.bucket_start >= ${iso(prev.from)}::timestamptz
       and s.bucket_start < ${iso(cur.to)}::timestamptz
      group by t.id`,
    sql<{ topic_id: string; h_ms: number; items: number }[]>`
      select s.topic_id,
             (extract(epoch from date_bin('1 hour', s.bucket_start, ${IST_HOUR_ORIGIN}::timestamptz)) * 1000)::float8 as h_ms,
             sum(s.items)::int as items
      from topic_stats_15m s
      where s.entity = ${f.entity} and s.lane = ${f.lane}
        and s.bucket_start >= ${iso(sparkFrom)}::timestamptz
        and s.bucket_start < ${iso(cur.to)}::timestamptz
      group by 1, 2`,
    sql<{ topic_id: string; n: number }[]>`
      select ec.topic_id,
             count(distinct coalesce(p.author_id::text, 'post:' || p.id::text))::int as n
      from posts p
      join effective_classifications ec on ec.post_id = p.id
      where p.published_at >= ${iso(cur.from)}::timestamptz
        and p.published_at < ${iso(cur.to)}::timestamptz
        and (${f.lane}::text = 'all' or p.lane = ${f.lane}::text)
        and (${f.entity}::text = 'all' or ${f.entity}::text = any(ec.entities))
      group by ec.topic_id`,
    sql<
      {
        series: MarketSeries
        value: number
        observed_ms: number
        source_key: SourceKey
        source_url: string
      }[]
    >`
      select distinct on (m.series) m.series, m.value,
             (extract(epoch from m.observed_at) * 1000)::float8 as observed_ms,
             m.source_key, m.source_url
      from market_points m
      where m.observed_at <= ${iso(now)}::timestamptz
      order by m.series, m.observed_at desc, m.fetched_at desc`,
    getLatestConfig(ctx.db),
    sourceHealth(ctx.db, now),
  ])

  const { config } = latest
  const minSplit = config.min_items_for_split
  const activeMin = config.active_min_items_24h

  // Spark: 24 IST-hour counts per topic, zero-filled.
  const hourIndex = new Map(hours.map((h, i) => [h.getTime(), i]))
  const spark = new Map<string, number[]>()
  for (const r of sparkRows) {
    const i = hourIndex.get(Number(r.h_ms))
    if (i === undefined) continue
    const arr = spark.get(r.topic_id) ?? new Array<number>(hours.length).fill(0)
    arr[i] = (arr[i] ?? 0) + r.items
    spark.set(r.topic_id, arr)
  }
  const authors = new Map(authorRows.map((r) => [r.topic_id, r.n]))

  // KPIs over every topic (seed, emerging, unclassified).
  let items24h = 0
  let itemsPrev24h = 0
  let pos = 0
  let neu = 0
  let neg = 0
  let lowConf = 0
  let suspected = 0
  // Reach is read from the rows of the requested lane only ('all' rows for lane=all), so the
  // lane rows are never added on top of the 'all' rows.
  const reachSum = { pos: 0, neu: 0, neg: 0 }
  let emergingCount = 0
  let emergingCandidates = 0
  let unclassifiedCount = 0
  const seedRows: TopicRow[] = []
  for (const r of topicRows) {
    items24h += r.items
    itemsPrev24h += r.items_prev
    pos += r.pos
    neu += r.neu
    neg += r.neg
    lowConf += r.low_conf
    suspected += r.suspected
    const reach = { pos: Number(r.reach_pos), neu: Number(r.reach_neu), neg: Number(r.reach_neg) }
    reachSum.pos += reach.pos
    reachSum.neu += reach.neu
    reachSum.neg += reach.neg
    if (r.kind === 'emerging') {
      emergingCount += r.items
      if (r.items > 0 && r.slug !== 'emerging' && r.status !== 'dismissed') emergingCandidates++
      continue
    }
    if (r.kind === 'unclassified') {
      unclassifiedCount += r.items
      continue
    }
    if (r.status === 'dismissed' || !isActive(r.items, activeMin)) continue
    const uniqueAuthors = authors.get(r.id) ?? 0
    const { trend, deltaPct } = trendOf(r.items, r.items_prev)
    seedRows.push({
      slug: r.slug,
      name: r.name,
      summary2line: r.summary_2line,
      summaryAt: msToIso(r.summary_at_ms),
      items: r.items,
      pos: r.pos,
      neu: r.neu,
      neg: r.neg,
      splitShown: splitShown(r.items, minSplit),
      itemsPrev24h: r.items_prev,
      uniqueAuthors24h: uniqueAuthors,
      score: round2(rankScore({ items: r.items, prev: r.items_prev, uniqueAuthors })),
      trend,
      deltaPct,
      lowConfPct: lowConfPct(r.low_conf, r.items),
      suspectedCoordinated: r.suspected,
      spark: spark.get(r.id) ?? new Array<number>(hours.length).fill(0),
      reach: reachSplit(reach, r.items, minSplit),
    })
  }

  // Freshness for enabled sources; market items use their source's rule.
  const healthByKey = new Map(health.map((h) => [h.sourceKey, h]))
  const freshness = SOURCE_KEYS.filter((k) => config.sources[k].enabled).map((k) =>
    freshnessOf(k, config, healthByKey.get(k), now),
  )
  const market: MarketStripItem[] = marketRows.map((m) => {
    const observedAt = new Date(Number(m.observed_ms))
    const src = freshnessOf(m.source_key, config, healthByKey.get(m.source_key), now)
    const lastSuccess = src.lastSuccessAt ? new Date(src.lastSuccessAt) : null
    // The value was last confirmed by the newer of its observation and the source's last success.
    const confirmed = lastSuccess && lastSuccess > observedAt ? lastSuccess : observedAt
    return {
      series: m.series,
      value: m.value,
      observedAt: iso(observedAt),
      sourceKey: m.source_key,
      sourceUrl: m.source_url,
      ageMin: minutesBetween(now, confirmed),
      stale: src.status !== 'ok',
    }
  })

  return {
    asOf: iso(now),
    lane: f.lane,
    minItemsForSplit: minSplit,
    activeMinItems: activeMin,
    kpis: {
      items24h,
      itemsPrev24h,
      pos,
      neu,
      neg,
      splitShown: splitShown(items24h, minSplit),
      lowConfPct: lowConfPct(lowConf, items24h),
      suspectedCoordinated: suspected,
      reach: reachSplit(reachSum, items24h, minSplit),
    },
    topics: rankTopics(seedRows),
    emerging: { count: emergingCount, candidates: emergingCandidates },
    unclassified: { count: unclassifiedCount },
    market: { items: market, unofficial: true },
    freshness,
  }
}
