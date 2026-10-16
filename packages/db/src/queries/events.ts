import { and, desc, eq, gt, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import {
  SOURCE_KEYS,
  startOfIstDay,
  type EventKind,
  type FetchRunStatus,
  type SourceKey,
} from '@jio/core'
import * as schema from '../schema'
import { eventLog } from '../schema'

/** A `Db` or a transaction handle (`db.transaction(async (tx) => ...)`). */
export type DbLike = PgDatabase<PostgresJsQueryResultHKT, typeof schema>

export type NewEvent = {
  kind: EventKind
  at?: Date
  sourceKey?: SourceKey
  status?: FetchRunStatus
  itemsNew?: number
  costUsd?: number
  durationMs?: number
  /** Truncated to 2,000 characters. */
  error?: string
  ip?: string
  /** Lowercased for login, login_failed, login_locked and logout. */
  actor?: string
  detail?: Record<string, unknown>
}

export type SourceHealthRow = {
  sourceKey: SourceKey
  lastRunAt: Date | null
  lastStatus: FetchRunStatus | null
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
  lastError: string | null
  runs24h: number
  items24h: number
  spend24hUsd: number
  /** Since 00:00 IST today. */
  spendTodayUsd: number
  spend7dUsd: number
  /** Error runs since the last ok run; skipped runs are ignored. */
  consecutiveFailures: number
}

export type FetchRunRow = {
  at: Date
  status: FetchRunStatus | null
  durationMs: number | null
  itemsNew: number | null
  costUsd: number | null
  error: string | null
}

const MAX_ERROR = 2000
const LOGIN_KINDS: ReadonlySet<EventKind> = new Set([
  'login',
  'login_failed',
  'login_locked',
  'logout',
])

export async function logEvent(db: DbLike, e: NewEvent): Promise<void> {
  const actor = e.actor == null ? null : LOGIN_KINDS.has(e.kind) ? e.actor.toLowerCase() : e.actor
  await db.insert(eventLog).values({
    kind: e.kind,
    at: e.at,
    sourceKey: e.sourceKey ?? null,
    status: e.status ?? null,
    itemsNew: e.itemsNew ?? null,
    costUsd: e.costUsd ?? null,
    durationMs: e.durationMs ?? null,
    error: e.error == null ? null : e.error.slice(0, MAX_ERROR),
    ip: e.ip ?? null,
    actor,
    detail: e.detail ?? {},
  })
}

type HealthSqlRow = {
  source_key: SourceKey
  last_run_ms: number | null
  last_status: FetchRunStatus | null
  last_success_ms: number | null
  last_error_ms: number | null
  last_error: string | null
  runs_24h: number
  items_24h: number
  spend_24h: number
  spend_today: number
  spend_7d: number
  consecutive_failures: number
}

const toDate = (ms: number | null) => (ms == null ? null : new Date(ms))
const epochMs = (col: string) => sql.raw(`(extract(epoch from ${col}) * 1000)::float8`)

/** Fetch-run health for every source in SOURCE_KEYS order, in one query over event_log. */
export async function sourceHealth(db: DbLike, now = new Date()): Promise<SourceHealthRow[]> {
  const nowTs = sql`${now.toISOString()}::timestamptz`
  const dayTs = sql`${startOfIstDay(now).toISOString()}::timestamptz`
  const keys = sql`array[${sql.join(
    SOURCE_KEYS.map((k) => sql`${k}`),
    sql`, `,
  )}]::text[]`

  const rows = await db.execute<HealthSqlRow>(sql`
    with k as (
      select t.key, t.ord from unnest(${keys}) with ordinality as t(key, ord)
    ),
    r as (
      select id, source_key, at, status, items_new, cost_usd, error
      from event_log
      where kind = 'fetch_run' and source_key = any(${keys}) and at <= ${nowTs}
    )
    select
      k.key as source_key,
      ${epochMs('agg.last_run_at')} as last_run_ms,
      last_run.status as last_status,
      ${epochMs('agg.last_success_at')} as last_success_ms,
      ${epochMs('agg.last_error_at')} as last_error_ms,
      last_err.error as last_error,
      agg.runs_24h::int as runs_24h,
      agg.items_24h::int as items_24h,
      agg.spend_24h::float8 as spend_24h,
      agg.spend_today::float8 as spend_today,
      agg.spend_7d::float8 as spend_7d,
      fails.n::int as consecutive_failures
    from k
    left join lateral (
      select
        max(r.at) as last_run_at,
        max(r.at) filter (where r.status = 'ok') as last_success_at,
        max(r.at) filter (where r.status = 'error') as last_error_at,
        count(*) filter (where r.at > ${nowTs} - interval '24 hours') as runs_24h,
        coalesce(sum(r.items_new) filter (where r.at > ${nowTs} - interval '24 hours'), 0) as items_24h,
        coalesce(sum(r.cost_usd) filter (where r.at > ${nowTs} - interval '24 hours'), 0) as spend_24h,
        coalesce(sum(r.cost_usd) filter (where r.at >= ${dayTs}), 0) as spend_today,
        coalesce(sum(r.cost_usd) filter (where r.at > ${nowTs} - interval '7 days'), 0) as spend_7d
      from r where r.source_key = k.key
    ) agg on true
    left join lateral (
      select r.status from r where r.source_key = k.key order by r.at desc, r.id desc limit 1
    ) last_run on true
    left join lateral (
      select r.error from r
      where r.source_key = k.key and r.status = 'error'
      order by r.at desc, r.id desc limit 1
    ) last_err on true
    left join lateral (
      select count(*) as n from r
      where r.source_key = k.key and r.status = 'error'
        and r.at > coalesce(agg.last_success_at, '-infinity'::timestamptz)
    ) fails on true
    order by k.ord
  `)

  return rows.map((r) => ({
    sourceKey: r.source_key,
    lastRunAt: toDate(r.last_run_ms),
    lastStatus: r.last_status,
    lastSuccessAt: toDate(r.last_success_ms),
    lastErrorAt: toDate(r.last_error_ms),
    lastError: r.last_error,
    runs24h: r.runs_24h,
    items24h: r.items_24h,
    spend24hUsd: r.spend_24h,
    spendTodayUsd: r.spend_today,
    spend7dUsd: r.spend_7d,
    consecutiveFailures: r.consecutive_failures,
  }))
}

/** The latest fetch runs of one source, newest first. */
export async function recentFetchRuns(
  db: DbLike,
  sourceKey: SourceKey,
  limit = 10,
): Promise<FetchRunRow[]> {
  return db
    .select({
      at: eventLog.at,
      status: eventLog.status,
      durationMs: eventLog.durationMs,
      itemsNew: eventLog.itemsNew,
      costUsd: eventLog.costUsd,
      error: eventLog.error,
    })
    .from(eventLog)
    .where(and(eq(eventLog.kind, 'fetch_run'), eq(eventLog.sourceKey, sourceKey)))
    .orderBy(desc(eventLog.at), desc(eventLog.id))
    .limit(limit)
}

/**
 * login_failed times for this email (case-insensitive) after both `since` and the email's last
 * successful login, newest first. 01-03 locks the login after 5 within 15 minutes.
 */
export async function loginFailuresSince(db: DbLike, email: string, since: Date): Promise<Date[]> {
  const actor = email.toLowerCase()
  const lastLogin = sql`coalesce((
    select max(l.at) from event_log l where l.kind = 'login' and l.actor = ${actor}
  ), '-infinity'::timestamptz)`
  const rows = await db
    .select({ at: eventLog.at })
    .from(eventLog)
    .where(
      and(
        eq(eventLog.kind, 'login_failed'),
        eq(eventLog.actor, actor),
        gt(eventLog.at, since),
        sql`${eventLog.at} > ${lastLogin}`,
      ),
    )
    .orderBy(desc(eventLog.at), desc(eventLog.id))
  return rows.map((r) => r.at)
}
