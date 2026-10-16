// Nightly retention (design: Retention). raw_json is cleared after 30 days; posts (with their
// classifications) are deleted after 90 days; authors with no remaining posts are deleted once
// last seen 90 days ago or past their delete_after. Rollups (topic_stats_15m), market_points,
// event_log and topics are never touched here.
import type { AppConfig } from '@jio/core'
import type { Sql } from './triage/repo'

export type RetentionWindows = { rawJsonDays: number; postDays: number; authorDays: number }

export type RetentionResult = {
  rawJsonCleared: number
  classificationsDeleted: number
  postsDeleted: number
  authorsDeleted: number
}

export function retentionWindows(config: Pick<AppConfig, 'retention_days'>): RetentionWindows {
  const r = config.retention_days
  return {
    rawJsonDays: r?.raw_json ?? 30,
    postDays: r?.post_text ?? 90,
    authorDays: r?.authors ?? 90,
  }
}

const DAY_MS = 86_400_000

/** One transaction; returns the number of rows changed per step. */
export async function runRetention(
  h: { sql: Sql },
  now: Date,
  windows: RetentionWindows,
): Promise<RetentionResult> {
  const rawCut = new Date(now.getTime() - windows.rawJsonDays * DAY_MS).toISOString()
  const postCut = new Date(now.getTime() - windows.postDays * DAY_MS).toISOString()
  const authorCut = new Date(now.getTime() - windows.authorDays * DAY_MS).toISOString()
  const nowIso = now.toISOString()

  return h.sql.begin(async (tx) => {
    const raw = await tx`
      update posts set raw_json = null
      where raw_json is not null and fetched_at < ${rawCut}::timestamptz`
    const cls = await tx`
      delete from classifications c
      using posts p
      where c.post_id = p.id and p.published_at < ${postCut}::timestamptz`
    const posts = await tx`
      delete from posts where published_at < ${postCut}::timestamptz`
    const authors = await tx`
      delete from authors a
      where not exists (select 1 from posts p where p.author_id = a.id)
        and (a.last_seen_at < ${authorCut}::timestamptz or a.delete_after < ${nowIso}::timestamptz)`
    return {
      rawJsonCleared: raw.count,
      classificationsDeleted: cls.count,
      postsDeleted: posts.count,
      authorsDeleted: authors.count,
    }
  })
}
