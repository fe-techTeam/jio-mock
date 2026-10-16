// Live Reddit adapter (02-03): OAuth client-credentials search over the watched subreddits, plus
// comments on the most active recent matched threads. At most 18 requests a run.
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
const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const API = 'https://oauth.reddit.com'
const MAX_QUERY_CHARS = 512
const MAX_COMMENT_THREADS = 10
const MAX_REQUESTS = 18
const TOKEN_SKEW_MS = 60_000
const MIN_RATELIMIT_REMAINING = 5
const FRESH_THREAD_MS = 48 * 3_600_000

export const WATCH_SUBREDDITS = [
  'IndianStockMarket',
  'IndiaInvestments',
  'StockMarketIndia',
  'IndianStreetBets',
  'india',
  'mumbai',
]

/** Bare 'jio' means 'live' in Hindi, so it is only searched together with an IPO word. */
const GUARDED_JIO = '(jio AND (ipo OR gmp OR allotment OR listing))'

/** Quoted company/IPO phrases and aliases OR-ed, then the guarded bare-word clause; at most 512 chars. */
export function buildRedditQuery(terms: TermsConfig): string {
  const ascii = (t: string) => /^[\x20-\x7E]+$/.test(t) && t.includes(' ')
  const candidates = [
    ...terms.ipo_terms.filter((t) => ascii(t) && /ipo/i.test(t)),
    ...terms.entities.jio.aliases.filter(ascii),
    ...terms.ipo_terms.filter((t) => ascii(t) && !/ipo/i.test(t)),
  ].map((t) => `"${t.replace(/"/g, '')}"`)
  const parts: string[] = []
  let len = GUARDED_JIO.length
  for (const c of new Set(candidates)) {
    const add = c.length + 4 // ' OR '
    if (len + add > MAX_QUERY_CHARS) continue
    parts.push(c)
    len += add
  }
  return [...parts, GUARDED_JIO].join(' OR ')
}

interface RedditThing {
  kind?: string
  data?: Record<string, unknown>
}
interface Listing {
  data?: { children?: RedditThing[] }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function authorOf(d: Record<string, unknown>): NormalizedAuthor | null {
  const handle = str(d.author)
  if (!handle || handle === '[deleted]') return null
  return {
    platform: 'reddit',
    platformUserId: str(d.author_fullname) ?? handle,
    handle,
    kind: 'other',
  }
}

function flattenComments(
  children: RedditThing[] | undefined,
  out: Record<string, unknown>[],
): void {
  for (const child of children ?? []) {
    if (child.kind !== 't1' || !child.data) continue
    out.push(child.data)
    const replies = child.data.replies as Listing | string | undefined
    if (replies && typeof replies === 'object') flattenComments(replies.data?.children, out)
  }
}

export function createRedditAdapter(
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): SourceAdapter {
  let token: { value: string; expiresAt: number } | null = null

  return {
    key: 'reddit',
    lane: 'social',
    requiredCreds: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('reddit', ctx)
      const doFetch = deps.fetch ?? globalThis.fetch
      const clock = deps.now ?? (() => new Date())
      const now = clock()
      const id = ctx.creds.REDDIT_CLIENT_ID
      const secret = ctx.creds.REDDIT_CLIENT_SECRET
      if (!id || !secret) throw new NotConfiguredError('Reddit client id or secret is missing')

      let requests = 0
      let stop = false

      const rateLimited = (res: Response): RateLimitedError => {
        const reset = Number(res.headers.get('x-ratelimit-reset'))
        const secs = Number.isFinite(reset) && reset > 0 ? reset : 60
        return new RateLimitedError('Reddit rate limited', new Date(now.getTime() + secs * 1000))
      }

      if (!token || token.expiresAt - TOKEN_SKEW_MS <= clock().getTime()) {
        requests += 1
        const res = await doFetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
          },
          body: 'grant_type=client_credentials',
          signal: ctx.signal,
        })
        if (res.status === 401 || res.status === 403) {
          throw new SourceAuthError(`Reddit rejected the client credentials (HTTP ${res.status})`)
        }
        if (res.status === 429) throw rateLimited(res)
        if (!res.ok) throw new Error(`Reddit token request failed: HTTP ${res.status}`)
        const body = (await res.json()) as { access_token?: string; expires_in?: number }
        if (!body.access_token) throw new Error('Reddit token response had no access_token')
        token = {
          value: body.access_token,
          expiresAt: clock().getTime() + (body.expires_in ?? 3600) * 1000,
        }
      }
      const bearer = token.value

      /** One authenticated GET; null when the run must stop or the request budget is spent. */
      const get = async (url: string): Promise<unknown | null> => {
        if (stop || requests >= MAX_REQUESTS) return null
        ctx.signal.throwIfAborted()
        requests += 1
        const res = await doFetch(url, {
          headers: { Authorization: `Bearer ${bearer}`, 'User-Agent': USER_AGENT },
          signal: ctx.signal,
        })
        if (res.status === 401) {
          token = null
          throw new SourceAuthError('Reddit rejected the access token (HTTP 401)')
        }
        if (res.status === 429) throw rateLimited(res)
        if (!res.ok) throw new Error(`Reddit request failed: HTTP ${res.status}`)
        const remaining = res.headers.get('x-ratelimit-remaining')
        if (remaining !== null && Number(remaining) < MIN_RATELIMIT_REMAINING) stop = true
        return res.json()
      }

      const q = buildRedditQuery(ctx.terms)
      const common = { sort: 'new', t: 'week', limit: '100', raw_json: '1' }
      const searches = [
        `${API}/search?${new URLSearchParams({ q, ...common })}`,
        ...WATCH_SUBREDDITS.map(
          (sub) =>
            `${API}/r/${sub}/search?${new URLSearchParams({ q, restrict_sr: '1', ...common })}`,
        ),
      ]

      const threads = new Map<string, Record<string, unknown>>()
      for (const url of searches) {
        const body = (await get(url)) as Listing | null
        if (!body) break
        for (const child of body.data?.children ?? []) {
          const d = child.data
          const name = d && str(d.name)
          if (child.kind === 't3' && d && name && !threads.has(name)) threads.set(name, d)
        }
      }

      const posts: NormalizedPost[] = []
      const inWindow: Record<string, unknown>[] = []
      for (const [name, d] of threads) {
        const publishedAt = new Date(num(d.created_utc) * 1000)
        if (publishedAt < ctx.since) continue
        inWindow.push(d)
        const title = str(d.title) ?? ''
        const selftext = str(d.selftext) ?? ''
        posts.push({
          sourceKey: 'reddit',
          externalId: name,
          url: `https://www.reddit.com${str(d.permalink) ?? ''}`,
          author: authorOf(d),
          text: selftext ? `${title}\n\n${selftext}` : title,
          publishedAt,
          reachRaw: { upvotes: num(d.score), comments: num(d.num_comments) },
          rawJson: { subreddit: str(d.subreddit), thread: d },
        })
      }

      const fresh = inWindow
        .filter(
          (d) =>
            num(d.num_comments) > 0 && now.getTime() - num(d.created_utc) * 1000 <= FRESH_THREAD_MS,
        )
        .sort((a, b) => num(b.num_comments) - num(a.num_comments))
        .slice(0, MAX_COMMENT_THREADS)

      const seenComments = new Set<string>()
      for (const thread of fresh) {
        const body = (await get(
          `${API}/comments/${str(thread.id)}?${new URLSearchParams({ sort: 'new', limit: '100', depth: '2', raw_json: '1' })}`,
        )) as Listing[] | null
        if (!body) break
        const flat: Record<string, unknown>[] = []
        flattenComments(body[1]?.data?.children, flat)
        for (const c of flat) {
          const cname = str(c.name)
          const text = str(c.body)
          if (!cname || !text || text === '[deleted]' || text === '[removed]') continue
          const publishedAt = new Date(num(c.created_utc) * 1000)
          if (publishedAt < ctx.since || seenComments.has(cname)) continue
          seenComments.add(cname)
          posts.push({
            sourceKey: 'reddit',
            externalId: cname,
            url: `https://www.reddit.com${str(c.permalink) ?? ''}`,
            author: authorOf(c),
            text,
            publishedAt,
            reachRaw: { upvotes: num(c.score) },
            rawJson: {
              parentTitle: str(thread.title),
              parentId: str(thread.name),
              subreddit: str(thread.subreddit),
              comment: c,
            },
          })
        }
      }

      return { posts, costUsd: 0 }
    },
  }
}

export default createRedditAdapter()
