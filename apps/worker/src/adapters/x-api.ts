// X API v2 recent-search adapter (02-02). Live mode pages through /2/tweets/search/recent with a
// bearer token; HTTP 429 becomes RateLimitedError so the scheduler hands X to the Apify fallback.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type {
  FetchContext,
  FetchResult,
  NormalizedAuthor,
  NormalizedPost,
  SourceAdapter,
  TermsConfig,
} from '@jio/core'
import { NotConfiguredError, RateLimitedError, SourceAuthError, SourceParseError } from '../breaker'
import { fixtureFetch } from './_fixture'

/** Estimated cost of one post read on X API pay-per-use (USD). Overridable via rate_limits.cost_per_post_usd. */
export const X_COST_PER_POST_USD = 0.005

/** Lowercased handles of business media; their posts are attributed by name in the evidence list. */
export const X_MEDIA_HANDLES = [
  'economictimes',
  'et_markets',
  'livemint',
  'moneycontrolcom',
  'bsindia',
  'financialxpress',
  'cnbctv18news',
  'cnbctv18live',
  'zeebusiness',
  'ndtvprofitindia',
  'businesstoday',
  'reuters',
  'ani',
  'ptinews',
] as const

const PUBLIC_FIGURE_MIN_FOLLOWERS = 100_000
const VERIFIED_TYPES = ['blue', 'business', 'government']
const DEFAULT_MAX_PAGES = 3
const MAX_LOOKBACK_MS = 7 * 86_400_000
const SEARCH_URL = 'https://api.x.com/2/tweets/search/recent'

/**
 * Conservative author kind (the evidence API shows a handle only for media_outlet or public_figure):
 * media_outlet for a known business-media handle; public_figure for a verified account with at
 * least 100,000 followers; otherwise other.
 */
export function xAuthorKind(a: {
  username?: string
  followers?: number
  verified?: boolean
  verifiedType?: string
}): NonNullable<NormalizedAuthor['kind']> {
  const handle = a.username?.toLowerCase()
  if (handle && (X_MEDIA_HANDLES as readonly string[]).includes(handle)) return 'media_outlet'
  const verified = a.verified === true || VERIFIED_TYPES.includes(a.verifiedType ?? '')
  if (verified && (a.followers ?? 0) >= PUBLIC_FIGURE_MIN_FOLLOWERS) return 'public_figure'
  return 'other'
}

/** Canonical tweet URL, shared with x_apify so a tweet seen by both gets the same url. */
export function xPostUrl(username: string | undefined, id: string): string {
  return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`
}

// ---------------------------------------------------------------------------------------------
// Query builder

const SUFFIX = ' -is:retweet'
const GROUP_OVERHEAD = 12

const needsQuote = (t: string) => /[\s.]|[^ -~]/.test(t)
const term = (t: string) => {
  if (t.startsWith('#')) return t
  const clean = t.replace(/"/g, '')
  return needsQuote(clean) ? `"${clean}"` : clean
}
const dedupe = (xs: string[]) => {
  const seen = new Set<string>()
  return xs.filter((x) => {
    const k = x.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** `(anchor (a OR b ...))` clauses, split so each stays below `limit` characters. */
function anchoredGroups(anchor: string, items: string[], limit: number): string[] {
  const out: string[] = []
  let cur: string[] = []
  const render = (xs: string[]) => `(${anchor} (${xs.join(' OR ')}))`
  for (const item of items) {
    if (cur.length > 0 && render([...cur, item]).length > limit) {
      out.push(render(cur))
      cur = []
    }
    cur.push(item)
  }
  if (cur.length > 0) out.push(render(cur))
  return out
}

/**
 * X search queries for the configured terms, each at most `maxLen` characters and ending with
 * ` -is:retweet`. Strong phrases, aliases and Jio-specific hashtags are OR-ed directly; ambiguous
 * words (bare 'jio', 'Ambani', generic hashtags) only appear inside a co-occurrence group. Negative
 * terms are not excluded here: triage (03-01) drops Jio Financial and JioHotstar items.
 */
export function buildXQueries(terms: TermsConfig, opts: { maxLen: number }): string[] {
  const limit = opts.maxLen - SUFFIX.length - GROUP_OVERHEAD
  const direct = dedupe([
    ...terms.ipo_terms,
    ...Object.values(terms.entities).flatMap((e) => e.aliases),
    ...terms.hashtags,
  ]).map(term)

  const oneWord = (g: string) =>
    (terms.anchor_groups.find((a) => a.name === g)?.terms ?? []).filter((t) => !/\s/.test(t))
  const jioAnchors = oneWord('jio')
  const ambaniAnchors = oneWord('ambani')
  const cooc = dedupe(terms.cooccurrence_terms).map(term)
  const generic = dedupe(terms.generic_hashtags)

  const grouped: string[] = []
  for (const a of jioAnchors) {
    grouped.push(...anchoredGroups(term(a), cooc, limit))
    grouped.push(...anchoredGroups(term(a), generic, limit))
  }
  for (const a of ambaniAnchors) grouped.push(`(${term(a)} (IPO OR Jio))`)

  const clauses = [...direct, ...grouped].filter((c) => c.length <= limit)
  const queries: string[] = []
  let cur: string[] = []
  const render = (cs: string[]) => `(${cs.join(' OR ')})${SUFFIX}`
  for (const c of clauses) {
    if (cur.length > 0 && render([...cur, c]).length > opts.maxLen) {
      queries.push(render(cur))
      cur = []
    }
    cur.push(c)
  }
  if (cur.length > 0) queries.push(render(cur))
  return queries
}

// ---------------------------------------------------------------------------------------------
// Response shapes

const Metrics = z
  .object({
    retweet_count: z.number().optional(),
    reply_count: z.number().optional(),
    like_count: z.number().optional(),
    quote_count: z.number().optional(),
    impression_count: z.number().optional(),
  })
  .passthrough()

const Tweet = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    created_at: z.string(),
    author_id: z.string().optional(),
    public_metrics: Metrics.optional(),
  })
  .passthrough()

const User = z
  .object({
    id: z.string(),
    username: z.string().optional(),
    name: z.string().optional(),
    verified: z.boolean().optional(),
    verified_type: z.string().optional(),
    public_metrics: z.object({ followers_count: z.number().optional() }).passthrough().optional(),
  })
  .passthrough()

const SearchPage = z.object({
  data: z.array(Tweet).default([]),
  includes: z.object({ users: z.array(User).default([]) }).default({}),
  meta: z
    .object({ newest_id: z.string().optional(), next_token: z.string().optional() })
    .passthrough()
    .default({}),
})
type SearchPage = z.infer<typeof SearchPage>

const queryHash = (q: string) => createHash('sha256').update(q).digest('hex').slice(0, 12)
const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function parseCursor(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function mapTweet(
  t: z.infer<typeof Tweet>,
  users: Map<string, z.infer<typeof User>>,
): NormalizedPost | null {
  const publishedAt = new Date(t.created_at)
  if (Number.isNaN(publishedAt.getTime())) return null
  const u = t.author_id ? users.get(t.author_id) : undefined
  const followers = u?.public_metrics?.followers_count
  const author: NormalizedAuthor | null = t.author_id
    ? {
        platform: 'x',
        platformUserId: t.author_id,
        handle: u?.username,
        displayName: u?.name,
        followers,
        kind: xAuthorKind({
          username: u?.username,
          followers,
          verified: u?.verified,
          verifiedType: u?.verified_type,
        }),
      }
    : null
  const m = t.public_metrics
  const reachRaw: Record<string, number> = {}
  const put = (k: string, v: number | undefined) => {
    if (typeof v === 'number') reachRaw[k] = v
  }
  put('followers', followers)
  put('likes', m?.like_count)
  put('retweets', m?.retweet_count)
  put('replies', m?.reply_count)
  put('quotes', m?.quote_count)
  put('impressions', m?.impression_count)
  return {
    sourceKey: 'x_api',
    externalId: t.id,
    url: xPostUrl(u?.username, t.id),
    author,
    text: t.text,
    publishedAt,
    reachRaw,
    rawJson: { tweet: t, author: u ?? null },
  }
}

export interface XApiDeps {
  fetch?: typeof fetch
  now?: () => Date
}

export function createXApiAdapter(deps: XApiDeps = {}): SourceAdapter {
  return {
    key: 'x_api',
    lane: 'social',
    requiredCreds: ['X_BEARER_TOKEN'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('x_api', ctx)
      const token = ctx.creds.X_BEARER_TOKEN
      if (!token) {
        throw new NotConfiguredError(
          'X_BEARER_TOKEN missing: live mode not built without credentials',
        )
      }
      const doFetch = deps.fetch ?? globalThis.fetch
      const now = (deps.now ?? (() => new Date()))()
      const tier = ctx.source.x_tier
      const maxLen = tier === 'pro' || tier === 'enterprise' ? 4096 : 512
      const maxPages = Math.max(
        1,
        Math.floor(ctx.source.rate_limits.max_pages_per_run ?? DEFAULT_MAX_PAGES),
      )
      const costPerPost = ctx.source.rate_limits.cost_per_post_usd ?? X_COST_PER_POST_USD
      const floor = now.getTime() - MAX_LOOKBACK_MS + 60_000
      const startTime = new Date(Math.max(ctx.since.getTime(), floor))
      const prev = parseCursor(ctx.cursor)
      const next: Record<string, string> = {}
      const posts = new Map<string, NormalizedPost>()

      for (const query of buildXQueries(ctx.terms, { maxLen })) {
        const hash = queryHash(query)
        const sinceId = prev[hash]
        if (sinceId) next[hash] = sinceId
        let nextToken: string | undefined
        for (let page = 0; page < maxPages; page++) {
          const url = new URL(SEARCH_URL)
          const p = url.searchParams
          p.set('query', query)
          p.set('max_results', '100')
          p.set('tweet.fields', 'created_at,public_metrics,lang,author_id,conversation_id')
          p.set('expansions', 'author_id')
          p.set('user.fields', 'username,name,public_metrics,verified,verified_type')
          if (sinceId) p.set('since_id', sinceId)
          else p.set('start_time', isoSeconds(startTime))
          if (nextToken) p.set('next_token', nextToken)

          const res = await doFetch(url.toString(), {
            headers: { Authorization: `Bearer ${token}` },
            signal: ctx.signal,
          })
          if (res.status === 429) {
            const reset = Number(res.headers.get('x-rate-limit-reset'))
            const resetAt =
              Number.isFinite(reset) && reset > 0
                ? new Date(reset * 1000)
                : new Date(now.getTime() + 15 * 60_000)
            throw new RateLimitedError('X API rate limited (429)', resetAt)
          }
          if (res.status === 401 || res.status === 403) {
            throw new SourceAuthError(`X API rejected the bearer token (${res.status})`)
          }
          if (!res.ok) throw new Error(`X API request failed with HTTP ${res.status}`)
          let body: SearchPage
          try {
            body = SearchPage.parse(await res.json())
          } catch (err) {
            throw new SourceParseError('X API returned an unexpected payload', { cause: err })
          }
          const users = new Map(body.includes.users.map((u) => [u.id, u]))
          for (const t of body.data) {
            if (posts.has(t.id)) continue
            const post = mapTweet(t, users)
            if (post) posts.set(t.id, post)
          }
          if (page === 0 && body.meta.newest_id) next[hash] = body.meta.newest_id
          nextToken = body.meta.next_token
          if (!nextToken) break
        }
      }

      const list = [...posts.values()]
      return {
        posts: list,
        nextCursor: Object.keys(next).length > 0 ? JSON.stringify(next) : ctx.cursor,
        costUsd: list.length * costPerPost,
      }
    },
  }
}

export default createXApiAdapter()
