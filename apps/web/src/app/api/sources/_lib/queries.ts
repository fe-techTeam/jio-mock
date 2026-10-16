// Raw reads for the Sources page that sourceHealth() does not cover. Parameters only.
import type { SourceKey } from '@jio/core'
import type { ReadCtx } from '@/lib/queries/ctx'
import { YOUTUBE_DAILY_QUOTA, type QuotaCard, type SourceMode } from './contract'

const PT = 'America/Los_Angeles'

/** YYYY-MM-DD of `d` in Pacific time (the YouTube quota day). */
export function ptDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PT }).format(d)
}

/** The next midnight in Pacific time (off by an hour on the two DST-change days). */
export function nextPtMidnight(d: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PT,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d)
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const sinceMidnightMs = ((n('hour') * 60 + n('minute')) * 60 + n('second')) * 1000
  return new Date(d.getTime() + 24 * 3_600_000 - sinceMidnightMs)
}

/** The mode each source's latest fetch_run recorded (detail.mode), when it did. */
export async function lastRunModes(ctx: ReadCtx): Promise<Partial<Record<SourceKey, SourceMode>>> {
  const rows = await ctx.sql<{ source_key: SourceKey; mode: string | null }[]>`
    select distinct on (source_key) source_key, detail->>'mode' as mode
    from event_log
    where kind = 'fetch_run' and at <= ${ctx.now.toISOString()}::timestamptz
    order by source_key, at desc, id desc`
  const out: Partial<Record<SourceKey, SourceMode>> = {}
  for (const r of rows) {
    if (r.mode === 'live' || r.mode === 'fixture') out[r.source_key] = r.mode
  }
  return out
}

/** Units used today (Pacific day) as reported by the latest youtube run (detail.quota). */
export async function youtubeQuota(ctx: ReadCtx): Promise<QuotaCard> {
  const rows = await ctx.sql<{ quota: { day?: unknown; unitsUsedToday?: unknown } | null }[]>`
    select detail->'quota' as quota
    from event_log
    where kind = 'fetch_run' and source_key = 'youtube' and detail->'quota' is not null
      and at <= ${ctx.now.toISOString()}::timestamptz
    order by at desc, id desc limit 1`
  const q = rows[0]?.quota
  const units =
    q && q.day === ptDay(ctx.now) && typeof q.unitsUsedToday === 'number' ? q.unitsUsedToday : null
  return {
    unitsUsedToday: units,
    limit: YOUTUBE_DAILY_QUOTA,
    resetsAt: nextPtMidnight(ctx.now).toISOString(),
  }
}
