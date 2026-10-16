// Live YouTube adapter (02-03): search.list for new videos, videos.list for their statistics and
// commentThreads.list for the tracked videos, paced to stay inside the 10,000-unit daily quota
// (Pacific-time day). The cursor carries the quota counter and the tracked videos; 02-01 copies
// `quota` into the fetch_run detail so the Sources page can show unitsUsedToday.
import type {
  FetchContext,
  FetchResult,
  NormalizedAuthor,
  NormalizedPost,
  SourceAdapter,
  TermsConfig,
} from '@jio/core'
import { NotConfiguredError, RateLimitedError, SourceAuthError } from '../breaker'
import { fixtureFetch } from './_fixture'

const USER_AGENT = 'jio-ipo-analysis/0.1 (+internal research)'
const API = 'https://www.googleapis.com/youtube/v3'
const DAY_MS = 86_400_000
const DAY_LIMIT = 10_000
const MAX_TRACKED = 20
const MAX_QUERY_CHARS = 400

/** Self-imposed daily ceiling in units; the rest of the 10,000 is headroom. */
export const BUDGET = 9000
const COST_SEARCH = 100
const COST_VIDEOS = 1
const COST_COMMENTS = 1
/** A search run: search + videos.list + 20 comment pages reserved for the same run. */
const SEARCH_RUN_RESERVE = COST_SEARCH + COST_VIDEOS + MAX_TRACKED
const ALLOWANCE_HEAD_START = 200

/** Channels whose videos are news coverage (lane media). */
export const YOUTUBE_NEWS_CHANNELS =
  /CNBC[-\s]?TV18|CNBC\s*Awaaz|\bET\s*Now\b|Zee\s*Business|NDTV\s*Profit|Moneycontrol|Business\s*Standard|^\s*Mint\s*$|\bLiveMint\b|Economic\s*Times|Business\s*Today/i

const PT_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function ptParts(now: Date) {
  const p: Record<string, string> = {}
  for (const part of PT_FORMAT.formatToParts(now)) p[part.type] = part.value
  const secs = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)
  return { day: `${p.year}-${p.month}-${p.day}`, secs }
}

/** The America/Los_Angeles calendar day, YYYY-MM-DD: YouTube's quota day. */
export const ptDay = (now: Date): string => ptParts(now).day

/** The next Pacific midnight (an hour off on the two DST-change days a year). */
export function nextPtMidnight(now: Date): Date {
  return new Date(now.getTime() + (86_400 - ptParts(now).secs) * 1000)
}

/** Units the run may have spent by `now`: BUDGET spread over the Pacific day, plus a head start. */
export function allowance(now: Date): number {
  const fraction = ptParts(now).secs / 86_400
  return Math.min(BUDGET, BUDGET * fraction + ALLOWANCE_HEAD_START)
}

/** Quoted company/IPO phrases joined with `|`, in English, Hindi and Gujarati; at most 400 chars. */
export function buildYoutubeQuery(terms: TermsConfig): string {
  const isAscii = (t: string) => /^[\x20-\x7E]+$/.test(t)
  const en = terms.ipo_terms.filter((t) => isAscii(t) && /ipo/i.test(t) && t.includes(' '))
  const enMain = en.filter((t) => !/\b(lagau|karu|ka|lena|kab)\b/i.test(t))
  const hi = terms.ipo_terms.filter((t) => /[ऀ-ॿ]/.test(t) && t.includes('आईपीओ'))
  const gu = terms.ipo_terms.filter((t) => /[઀-૿]/.test(t) && t.includes('આઈપીઓ'))
  const ordered = [...enMain.slice(0, 5), ...hi.slice(0, 2), ...gu.slice(0, 2), ...enMain.slice(5)]
  const parts: string[] = []
  let len = 0
  for (const t of new Set(ordered)) {
    const q = `"${t.replace(/"/g, '')}"`
    const add = q.length + (parts.length ? 1 : 0)
    if (len + add > MAX_QUERY_CHARS) continue
    parts.push(q)
    len += add
  }
  return parts.join('|')
}

interface TrackedVideo {
  id: string
  publishedAt: string
  views: number
}
interface QuotaState {
  day: string
  unitsUsedToday: number
  limit: number
  resetsAt: string
}
interface Cursor {
  v: 1
  quota: QuotaState
  tracked: TrackedVideo[]
}

function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null
  try {
    const c = JSON.parse(raw) as Partial<Cursor>
    if (c.v !== 1 || !c.quota || !Array.isArray(c.tracked)) return null
    return c as Cursor
  } catch {
    return null
  }
}

interface VideoSnippet {
  publishedAt?: string
  channelId?: string
  channelTitle?: string
  title?: string
  description?: string
}
interface VideoItem {
  id?: string
  snippet?: VideoSnippet
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string }
}
interface SearchItem {
  id?: { videoId?: string }
  snippet?: VideoSnippet
}
interface CommentThread {
  id?: string
  snippet?: {
    videoId?: string
    totalReplyCount?: number
    topLevelComment?: {
      id?: string
      snippet?: {
        textDisplay?: string
        textOriginal?: string
        authorDisplayName?: string
        authorChannelId?: { value?: string }
        likeCount?: number
        publishedAt?: string
      }
    }
  }
}

const toNum = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0
  return Number.isFinite(n) ? n : 0
}

export function createYoutubeAdapter(
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): SourceAdapter {
  return {
    key: 'youtube',
    lane: 'social',
    requiredCreds: ['YOUTUBE_API_KEY'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('youtube', ctx)
      const doFetch = deps.fetch ?? globalThis.fetch
      const now = (deps.now ?? (() => new Date()))()
      const key = ctx.creds.YOUTUBE_API_KEY
      if (!key) throw new NotConfiguredError('YOUTUBE_API_KEY is missing')

      const prev = parseCursor(ctx.cursor)
      const day = ptDay(now)
      const resetsAt = nextPtMidnight(now)
      let units = prev && prev.quota.day === day ? prev.quota.unitsUsedToday : 0
      const weekAgo = now.getTime() - 7 * DAY_MS
      const channelIds = new Set(
        Array.isArray(ctx.source.params.news_channel_ids)
          ? (ctx.source.params.news_channel_ids as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : [],
      )

      type Result<T> = { ok: true; body: T } | { ok: false; status: number; reason: string }
      /** One GET. Quota and key errors throw; any other failure is returned to the caller. */
      const call = async <T>(path: string, params: Record<string, string>): Promise<Result<T>> => {
        ctx.signal.throwIfAborted()
        const url = `${API}/${path}?${new URLSearchParams({ ...params, key })}`
        const res = await doFetch(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
          signal: ctx.signal,
        })
        if (res.ok) return { ok: true, body: (await res.json()) as T }
        let reason = ''
        let message = ''
        try {
          const body = (await res.json()) as {
            error?: { message?: string; errors?: { reason?: string }[] }
          }
          reason = body.error?.errors?.[0]?.reason ?? ''
          message = body.error?.message ?? ''
        } catch {
          // non-JSON error body
        }
        if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
          throw new RateLimitedError('YouTube daily quota exceeded', resetsAt)
        }
        if (
          reason === 'keyInvalid' ||
          reason === 'accessNotConfigured' ||
          reason === 'ipRefererBlocked' ||
          (res.status === 400 && /API key not valid/i.test(message))
        ) {
          throw new SourceAuthError(`YouTube rejected the API key (${reason || res.status})`)
        }
        return { ok: false, status: res.status, reason }
      }

      const fail = (what: string, r: { status: number; reason: string }) =>
        new Error(`YouTube ${what} failed: HTTP ${r.status} ${r.reason}`.trim())

      const posts: NormalizedPost[] = []
      const videoPost = (id: string, s: VideoSnippet, stats: VideoItem['statistics']) => {
        const title = s.title ?? ''
        const description = s.description ?? ''
        const channelTitle = s.channelTitle ?? ''
        const isNews =
          YOUTUBE_NEWS_CHANNELS.test(channelTitle) || (!!s.channelId && channelIds.has(s.channelId))
        const author: NormalizedAuthor | null = s.channelId
          ? {
              platform: 'youtube',
              platformUserId: s.channelId,
              displayName: channelTitle || undefined,
              kind: isNews ? 'media_outlet' : 'other',
            }
          : null
        posts.push({
          sourceKey: 'youtube',
          externalId: `video:${id}`,
          url: `https://www.youtube.com/watch?v=${id}`,
          author,
          text: description ? `${title}\n\n${description}` : title,
          publishedAt: new Date(s.publishedAt ?? now.toISOString()),
          reachRaw: {
            views: toNum(stats?.viewCount),
            likes: toNum(stats?.likeCount),
            comments: toNum(stats?.commentCount),
          },
          rawJson: { video: { id, snippet: s, statistics: stats } },
        })
      }

      // Existing tracked videos still inside the 7-day window.
      let tracked: TrackedVideo[] = (prev?.tracked ?? []).filter(
        (t) => new Date(t.publishedAt).getTime() >= weekAgo,
      )
      const knownIds = new Set(tracked.map((t) => t.id))

      if (units + SEARCH_RUN_RESERVE <= allowance(now)) {
        const publishedAfter = new Date(Math.max(ctx.since.getTime(), weekAgo)).toISOString()
        const search = await call<{ items?: SearchItem[] }>('search', {
          part: 'snippet',
          type: 'video',
          order: 'date',
          maxResults: '50',
          regionCode: 'IN',
          publishedAfter,
          q: buildYoutubeQuery(ctx.terms),
        })
        if (!search.ok) throw fail('search', search)
        units += COST_SEARCH
        const found = new Map<string, VideoSnippet>()
        for (const item of search.body.items ?? []) {
          const id = item.id?.videoId
          if (id && item.snippet && !knownIds.has(id)) found.set(id, item.snippet)
        }
        if (found.size > 0) {
          const vids = await call<{ items?: VideoItem[] }>('videos', {
            part: 'snippet,statistics',
            id: [...found.keys()].join(','),
          })
          if (!vids.ok) throw fail('videos.list', vids)
          units += COST_VIDEOS
          const stats = new Map((vids.body.items ?? []).map((v) => [v.id ?? '', v]))
          for (const [id, searchSnippet] of found) {
            const v = stats.get(id)
            const snippet = { ...searchSnippet, ...v?.snippet }
            videoPost(id, snippet, v?.statistics)
            tracked.push({
              id,
              publishedAt: snippet.publishedAt ?? now.toISOString(),
              views: toNum(v?.statistics?.viewCount),
            })
          }
        }
      }

      const byViews = (a: TrackedVideo, b: TrackedVideo) => b.views - a.views
      tracked = tracked
        .filter((t) => new Date(t.publishedAt).getTime() >= weekAgo)
        .sort(byViews)
        .slice(0, MAX_TRACKED)

      const dropped = new Set<string>()
      for (const t of tracked) {
        if (units + COST_COMMENTS > BUDGET) break
        const res = await call<{ items?: CommentThread[] }>('commentThreads', {
          part: 'snippet',
          videoId: t.id,
          order: 'time',
          maxResults: '100',
          textFormat: 'plainText',
        })
        units += COST_COMMENTS
        if (!res.ok) {
          if (
            res.reason === 'commentsDisabled' ||
            res.reason === 'videoNotFound' ||
            res.status === 404
          ) {
            dropped.add(t.id)
          }
          continue
        }
        for (const thread of res.body.items ?? []) {
          const top = thread.snippet?.topLevelComment
          const cs = top?.snippet
          const cid = top?.id ?? thread.id
          const text = cs?.textDisplay ?? cs?.textOriginal
          if (!cid || !text || !cs?.publishedAt) continue
          const publishedAt = new Date(cs.publishedAt)
          if (publishedAt < ctx.since) continue
          const name = cs.authorDisplayName
          const channel = cs.authorChannelId?.value ?? name
          posts.push({
            sourceKey: 'youtube',
            externalId: `comment:${cid}`,
            url: `https://www.youtube.com/watch?v=${t.id}&lc=${cid}`,
            author: channel
              ? { platform: 'youtube', platformUserId: channel, displayName: name, kind: 'other' }
              : null,
            text,
            publishedAt,
            reachRaw: {
              likes: toNum(cs.likeCount),
              replies: toNum(thread.snippet?.totalReplyCount),
            },
            rawJson: { videoId: t.id, thread },
          })
        }
      }

      const cursor: Cursor = {
        v: 1,
        quota: { day, unitsUsedToday: units, limit: DAY_LIMIT, resetsAt: resetsAt.toISOString() },
        tracked: tracked.filter((t) => !dropped.has(t.id)),
      }
      return { posts, nextCursor: JSON.stringify(cursor), costUsd: 0 }
    },
  }
}

export default createYoutubeAdapter()
