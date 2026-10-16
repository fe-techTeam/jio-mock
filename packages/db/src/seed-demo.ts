// Demo-board helpers (07-01). `pnpm demo` loads every fixture adapter, then uses these to make
// the fixtures look like a live week: more authors, timestamps spread over 7 days, one deliberate
// coordinated cluster and hourly market history. Everything is deterministic for a given seed and
// `now`, pure SQL through drizzle, and touches only fixture rows (is_fixture = true), `#demo`
// market points and recent rollups. event_log and live posts are never modified.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { MARKET_SERIES, SOURCE_KEYS, type MarketSeries, type SourceKey } from '@jio/core'
import { authors, marketPoints, posts, topicStats15m } from './schema'
import type { Db } from './client'
import { insertMarketPoints } from './queries/market'

const H = 3_600_000
const DAY = 24 * H
const MIN = 60_000
const VARIANT_RE = '~[dc][0-9]+$'
const DEMO_AUTHOR_RETENTION_MS = 90 * DAY
const COORDINATED_AUTHORS = 6
const HINGLISH_RE = /\b(hai|nahi|kya|bhai|paisa|lagta|hoga|karo|mat|lena|chahiye|aayega)\b/i

/** Deterministic PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Deletes fixture posts and everything derived from them (rollups of the last 7 days). */
export async function resetDemoData(
  db: Db,
  opts: { now: Date },
): Promise<{ postsDeleted: number }> {
  const from = new Date(opts.now.getTime() - 7 * DAY - H)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`delete from classifications where post_id in (select id from posts where is_fixture)`,
    )
    const deleted = await tx
      .delete(posts)
      .where(eq(posts.isFixture, true))
      .returning({ id: posts.id })
    await tx.execute(
      sql`delete from authors a where not exists (select 1 from posts p where p.author_id = a.id)`,
    )
    await tx.execute(
      sql`delete from topics t
          where t.kind = 'emerging' and t.promoted_at is null
            and not exists (select 1 from classifications c where c.topic_id = t.id)`,
    )
    await tx.delete(marketPoints).where(sql`${marketPoints.sourceUrl} like '%#demo'`)
    await tx
      .delete(topicStats15m)
      .where(sql`${topicStats15m.bucketStart} >= ${from.toISOString()}::timestamptz`)
    return { postsDeleted: deleted.length }
  })
}

type OriginalRow = {
  id: string
  sourceKey: SourceKey
  externalId: string
  url: string
  lane: 'social' | 'media'
  text: string
  publishedAt: Date
  fetchedAt: Date
  reachRaw: Record<string, number>
}

async function demoAuthorIds(db: Db, ids: string[], now: Date): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const deleteAfter = new Date(now.getTime() + DEMO_AUTHOR_RETENTION_MS)
  for (let i = 0; i < ids.length; i += 500) {
    await db
      .insert(authors)
      .values(
        ids.slice(i, i + 500).map((id) => ({
          platform: 'demo',
          platformUserId: id,
          handle: id,
          displayName: id,
          kind: 'other' as const,
          deleteAfter,
        })),
      )
      .onConflictDoNothing({ target: [authors.platform, authors.platformUserId] })
  }
  const map = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: authors.id, pid: authors.platformUserId })
      .from(authors)
      .where(
        and(eq(authors.platform, 'demo'), inArray(authors.platformUserId, ids.slice(i, i + 500))),
      )
    for (const r of rows) map.set(r.pid, r.id)
  }
  return map
}

/**
 * For each fixture post creates `copies - 1` variants under synthetic authors, plus exactly one
 * coordinated cluster of 6 variants of the first Hinglish X post. Re-running adds nothing.
 */
export async function amplifyFixturePosts(
  db: Db,
  opts: { seed: number; copies?: number; now?: Date },
): Promise<{ variants: number; coordinated: number }> {
  const copies = Math.max(1, opts.copies ?? 3)
  const now = opts.now ?? new Date()
  const originals = (await db
    .select({
      id: posts.id,
      sourceKey: posts.sourceKey,
      externalId: posts.externalId,
      url: posts.url,
      lane: posts.lane,
      text: posts.text,
      publishedAt: posts.publishedAt,
      fetchedAt: posts.fetchedAt,
      reachRaw: posts.reachRaw,
    })
    .from(posts)
    .where(and(eq(posts.isFixture, true), sql`${posts.externalId} !~ ${VARIANT_RE}`))
    .orderBy(posts.sourceKey, posts.externalId)) as OriginalRow[]

  const wanted: { orig: OriginalRow; suffix: string; authorKey: string; demo?: string }[] = []
  for (const orig of originals) {
    for (let n = 1; n < copies; n++) {
      wanted.push({
        orig,
        suffix: `~d${n}`,
        authorKey: `demo-${n}-${orig.sourceKey}-${orig.externalId}`,
      })
    }
  }
  const social = originals.filter((o) => o.lane === 'social')
  const xPosts = social.filter((o) => o.sourceKey === 'x_api' || o.sourceKey === 'x_apify')
  const seedPost =
    xPosts.find((o) => HINGLISH_RE.test(o.text)) ?? xPosts[0] ?? social[0] ?? originals[0]
  if (seedPost) {
    for (let n = 1; n <= COORDINATED_AUTHORS; n++) {
      wanted.push({
        orig: seedPost,
        suffix: `~c${n}`,
        authorKey: `demo-c${n}-${seedPost.sourceKey}-${seedPost.externalId}`,
        demo: 'coordinated',
      })
    }
  }

  const authorMap = await demoAuthorIds(
    db,
    wanted.map((w) => w.authorKey),
    now,
  )
  let variants = 0
  let coordinated = 0
  for (let i = 0; i < wanted.length; i += 300) {
    const chunk = wanted.slice(i, i + 300)
    const inserted = await db
      .insert(posts)
      .values(
        chunk.map((w) => ({
          sourceKey: w.orig.sourceKey,
          externalId: w.orig.externalId + w.suffix,
          url: w.orig.url,
          authorId: authorMap.get(w.authorKey) ?? null,
          lane: w.orig.lane,
          text: w.orig.text,
          publishedAt: w.orig.publishedAt,
          fetchedAt: w.orig.fetchedAt,
          reachRaw: w.orig.reachRaw,
          rawJson: w.demo ? { demo: w.demo } : { demo: 'variant' },
          isFixture: true,
        })),
      )
      .onConflictDoNothing({ target: [posts.sourceKey, posts.externalId] })
      .returning({ externalId: posts.externalId })
    for (const r of inserted) {
      if (/~c[0-9]+$/.test(r.externalId)) coordinated++
      else variants++
    }
  }
  return { variants, coordinated }
}

/**
 * Reassigns published_at (and fetched_at = +2 min) of every fixture post: 45% in the last 24h, 20%
 * in the 24h before, the rest in days 3-7. Variants of one original are at least 3h apart; the
 * coordinated cluster lands inside a 30-minute window in the last 24h. Nothing is later than
 * now - 1 min.
 */
export async function spreadFixtureTimestamps(
  db: Db,
  opts: { now: Date; seed: number },
): Promise<{ updated: number }> {
  const rand = mulberry32(opts.seed)
  const rows = await db
    .select({
      id: posts.id,
      sourceKey: posts.sourceKey,
      externalId: posts.externalId,
      demo: sql<string | null>`${posts.rawJson}->>'demo'`,
    })
    .from(posts)
    .where(eq(posts.isFixture, true))
    .orderBy(posts.sourceKey, posts.externalId)

  const nowMs = opts.now.getTime()
  const latestOffset = MIN // never later than now - 1 min
  const assigned = new Map<string, number>() // id -> offset before now (ms)

  const coord = rows.filter((r) => r.demo === 'coordinated')
  const rest = rows.filter((r) => r.demo !== 'coordinated')

  // Coordinated cluster: window start 2h..23h ago, members 0..29 min apart.
  const clusterStart = 2 * H + rand() * 21 * H
  coord.forEach((r, i) => {
    const within = Math.min(29 * MIN, i * 5 * MIN + Math.floor(rand() * 4 * MIN))
    assigned.set(r.id, clusterStart - within)
  })

  // Stratified categories, shuffled deterministically.
  const total = rows.length
  const nA = Math.max(0, Math.round(0.45 * total) - coord.length)
  const nB = Math.round(0.2 * total)
  const order = rest.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const category = new Map<string, 'A' | 'B' | 'C'>()
  order.forEach((idx, rank) => {
    category.set(rest[idx]!.id, rank < nA ? 'A' : rank < nA + nB ? 'B' : 'C')
  })
  const draw = (c: 'A' | 'B' | 'C'): number => {
    if (c === 'A') return latestOffset + rand() * (DAY - 2 * MIN)
    if (c === 'B') return DAY + rand() * DAY
    return 2 * DAY + rand() * (5 * DAY - 2 * MIN)
  }

  const groups = new Map<string, typeof rest>()
  for (const r of rest) {
    const base = `${r.sourceKey}\u0001${r.externalId.split('~')[0]}`
    groups.set(base, [...(groups.get(base) ?? []), r])
  }
  for (const members of groups.values()) {
    const offs = members.map((m) => draw(category.get(m.id)!))
    for (let attempt = 0; attempt < 400; attempt++) {
      let bad = -1
      for (let i = 0; i < offs.length && bad < 0; i++) {
        for (let j = 0; j < i; j++) {
          if (Math.abs(offs[i]! - offs[j]!) < 3 * H) {
            bad = i
            break
          }
        }
      }
      if (bad < 0) break
      offs[bad] = draw(category.get(members[bad]!.id)!)
    }
    members.forEach((m, i) => assigned.set(m.id, offs[i]!))
  }

  // Last resort for groups the sampler could not separate: stagger by 3h steps.
  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => assigned.get(a.id)! - assigned.get(b.id)!)
    for (let i = 1; i < sorted.length; i++) {
      const prev = assigned.get(sorted[i - 1]!.id)!
      if (assigned.get(sorted[i]!.id)! - prev < 3 * H) assigned.set(sorted[i]!.id, prev + 3 * H)
    }
  }

  await db.transaction(async (tx) => {
    for (const [id, off] of assigned) {
      const at = new Date(nowMs - Math.max(latestOffset, off))
      await tx
        .update(posts)
        .set({ publishedAt: at, fetchedAt: new Date(at.getTime() + 2 * MIN) })
        .where(eq(posts.id, id))
    }
  })
  return { updated: assigned.size }
}

/**
 * Hourly market history for 7 days. Each series ends at its newest fixture value: GMP is a bounded
 * random walk, subscriptions rise monotonically over the last 72h from 0. Points carry the
 * fixture's source key and a `#demo` url suffix so a reset removes them.
 */
export async function synthesizeMarketHistory(
  db: Db,
  opts: { now: Date; seed: number },
): Promise<{ inserted: number }> {
  const rand = mulberry32(opts.seed ^ 0x9e3779b9)
  const base = Math.floor(opts.now.getTime() / H) * H
  const out: {
    series: MarketSeries
    value: number
    observedAt: Date
    sourceKey: SourceKey
    sourceUrl: string
  }[] = []

  for (const series of MARKET_SERIES) {
    const [latest] = await db
      .select()
      .from(marketPoints)
      .where(and(eq(marketPoints.series, series), sql`${marketPoints.sourceUrl} not like '%#demo'`))
      .orderBy(sql`${marketPoints.observedAt} desc`)
      .limit(1)
    if (!latest || !SOURCE_KEYS.includes(latest.sourceKey)) continue
    const v = latest.value
    const url = latest.sourceUrl.replace(/#fixture$/, '') + '#demo'
    const anchor = Math.min(base, Math.floor(latest.observedAt.getTime() / H) * H)
    const start = base - 7 * DAY
    const hours: number[] = []
    for (let t = start; t <= base; t += H) hours.push(t)

    const values = new Map<number, number>()
    if (series === 'gmp_inr') {
      let cur = v
      const lo = v * 0.6
      const hi = v * 1.4
      const step = Math.max(Math.abs(v) * 0.06, 1)
      for (let t = base; t >= start; t -= H) {
        if (t >= anchor) {
          values.set(t, v)
          continue
        }
        cur = Math.min(hi, Math.max(lo, cur + (rand() * 2 - 1) * step))
        values.set(t, round2(Math.max(0, cur)))
      }
    } else {
      const rampStart = Math.min(base - 72 * H, anchor - DAY)
      const ramp = hours.filter((t) => t > rampStart && t <= anchor)
      const incs = ramp.map(() => 0.2 + rand())
      const sum = incs.reduce((a, b) => a + b, 0)
      let acc = 0
      ramp.forEach((t, i) => {
        acc += incs[i]!
        values.set(t, i === ramp.length - 1 ? v : round2((v * acc) / sum))
      })
      for (const t of hours) {
        if (t <= rampStart) values.set(t, 0)
        else if (t > anchor) values.set(t, v)
      }
    }
    for (const t of hours) {
      out.push({
        series,
        value: values.get(t) ?? v,
        observedAt: new Date(t),
        sourceKey: latest.sourceKey,
        sourceUrl: url,
      })
    }
  }
  const res = await insertMarketPoints(db, out)
  return { inserted: res.inserted }
}

export type DemoSnapshot = {
  posts: number
  bySource: Record<SourceKey, number>
  classified: number
  unclassified: number
  topics24h: { slug: string; items: number }[]
  marketPoints: Record<MarketSeries, number>
  suspectedCoordinated: number
}

/** Counts that must be identical between two `pnpm demo` runs. */
export async function demoSnapshot(db: Db, opts: { now: Date }): Promise<DemoSnapshot> {
  const bySource = Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0])) as Record<SourceKey, number>
  const perSource = await db.execute<{ k: SourceKey; n: number }>(
    sql`select source_key as k, count(*)::int as n from posts where is_fixture group by 1`,
  )
  for (const r of perSource) bySource[r.k] = r.n

  const [counts] = await db.execute<{ total: number; classified: number; coord: number }>(
    sql`select count(*)::int as total,
               (count(*) filter (where exists
                 (select 1 from effective_classifications ec where ec.post_id = p.id)))::int
                 as classified,
               (count(*) filter (where coord_suspected))::int as coord
        from posts p where is_fixture`,
  )
  const total = counts?.total ?? 0
  const classified = counts?.classified ?? 0

  const from = new Date(opts.now.getTime() - DAY)
  // Emerging topics get a slug derived from random post ids, so they are keyed by name instead.
  const topicRows = await db.execute<{ slug: string; items: number }>(
    sql`select case when t.kind = 'emerging' then 'emerging:' || t.name else t.slug end as slug,
               sum(s.items)::int as items
        from topic_stats_15m s join topics t on t.id = s.topic_id
        where s.entity = 'all' and s.lane = 'all'
          and s.bucket_start > ${from.toISOString()}::timestamptz
          and s.bucket_start <= ${opts.now.toISOString()}::timestamptz
          and t.slug <> 'unclassified'
        group by 1 having sum(s.items) > 0
        order by sum(s.items) desc, 1`,
  )

  const marketPointCounts = Object.fromEntries(MARKET_SERIES.map((s) => [s, 0])) as Record<
    MarketSeries,
    number
  >
  const mp = await db.execute<{ s: MarketSeries; n: number }>(
    sql`select series as s, count(*)::int as n from market_points group by 1`,
  )
  for (const r of mp) marketPointCounts[r.s] = r.n

  return {
    posts: total,
    bySource,
    classified,
    unclassified: total - classified,
    topics24h: topicRows.map((r) => ({ slug: r.slug, items: r.items })),
    marketPoints: marketPointCounts,
    suspectedCoordinated: counts?.coord ?? 0,
  }
}
