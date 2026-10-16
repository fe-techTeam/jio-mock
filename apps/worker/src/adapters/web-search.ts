// Live web-search adapter (02-03): Serper (Google results) with site: queries for Instagram and
// LinkedIn posts plus brokerage commentary. Cost is estimated at SERPER_COST_PER_QUERY_USD a query.
import { createHash } from 'node:crypto'
import type {
  FetchContext,
  FetchResult,
  NormalizedAuthor,
  NormalizedPost,
  SourceAdapter,
} from '@jio/core'
import { RateLimitedError, SourceAuthError } from '../breaker'
import { fixtureFetch } from './_fixture'

const USER_AGENT = 'jio-ipo-analysis/0.1 (+internal research)'
const SERPER_URL = 'https://google.serper.dev/search'
const DAY_MS = 86_400_000

/** Estimated, not billed: Serper's published rate is about 1 USD per 1,000 queries. */
export const SERPER_COST_PER_QUERY_USD = 0.001

/** Domains whose results are outlets or brokerages (lane media). */
export const DOMAIN_OUTLETS: Record<string, string> = {
  'groww.in': 'Groww',
  'emkayglobal.com': 'Emkay Global',
  'centrum.co.in': 'Centrum',
  'livemint.com': 'Mint',
  'economictimes.indiatimes.com': 'Economic Times',
  'moneycontrol.com': 'Moneycontrol',
  'business-standard.com': 'Business Standard',
  'financialexpress.com': 'Financial Express',
  'chittorgarh.com': 'Chittorgarh',
  'investorgain.com': 'Investorgain',
  'ipowatch.in': 'IPOWatch',
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Serper dates: '3 hours ago', 'Oct 15, 2026', '15 Oct 2026'. Anything else (or none) is now. */
export function parseSerperDate(raw: string | undefined, now: Date): Date {
  if (!raw) return now
  const s = raw.trim().toLowerCase()
  const rel = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/.exec(s)
  if (rel) return new Date(now.getTime() - Number(rel[1]) * UNIT_MS[rel[2]!]!)
  const mdy = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  const dmy = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s)
  const parts = mdy ? [mdy[3], mdy[1], mdy[2]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null
  if (parts) {
    const month = MONTHS.indexOf(parts[1]!)
    if (month >= 0) return new Date(Date.UTC(Number(parts[0]), month, Number(parts[2])))
  }
  return now
}

function parseUrl(link: string): URL | null {
  try {
    return new URL(link)
  } catch {
    return null
  }
}

const hash16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)

/** Host without www, plus path without trailing slash; query and hash are dropped. */
function normalizeLink(u: URL): string {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  return `${host}${u.pathname.replace(/\/+$/, '')}`
}

function outletFor(host: string): { domain: string; name: string } | null {
  for (const [domain, name] of Object.entries(DOMAIN_OUTLETS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return { domain, name }
  }
  return null
}

const IG_POST_SEGMENTS = new Set(['p', 'reel', 'reels', 'tv', 'explore'])

function authorFor(u: URL): NormalizedAuthor {
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const segs = u.pathname.split('/').filter(Boolean)
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const first = segs[0]
    if (first && IG_POST_SEGMENTS.has(first) && segs[1]) {
      return { platform: 'instagram', platformUserId: `ig-post:${segs[1]}`, kind: 'other' }
    }
    const handle = first
    if (handle) return { platform: 'instagram', platformUserId: handle, handle, kind: 'other' }
    return {
      platform: 'instagram',
      platformUserId: `ig-post:${hash16(normalizeLink(u))}`,
      kind: 'other',
    }
  }
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (segs[0] === 'posts' && segs[1]) {
      const handle = segs[1].split('_')[0]!
      return { platform: 'linkedin', platformUserId: handle, handle, kind: 'other' }
    }
    return {
      platform: 'linkedin',
      platformUserId: `li-page:${hash16(normalizeLink(u))}`,
      kind: 'other',
    }
  }
  const outlet = outletFor(host)
  if (outlet) {
    return {
      platform: 'web',
      platformUserId: outlet.domain,
      displayName: outlet.name,
      kind: 'media_outlet',
    }
  }
  return { platform: 'web', platformUserId: host, displayName: host }
}

function buildQueries(phrases: string[]): string[] {
  const out: string[] = []
  for (const p of phrases.slice(0, 2)) {
    out.push(
      `site:instagram.com "${p}"`,
      `site:linkedin.com/posts "${p}"`,
      `"${p}" Groww`,
      `"${p}" (Emkay OR Centrum)`,
    )
  }
  return out
}

type SerperResult = { title?: string; link?: string; snippet?: string; date?: string }

export function createWebSearchAdapter(
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): SourceAdapter {
  return {
    key: 'web_search',
    lane: 'media',
    requiredCreds: ['SERPER_API_KEY'],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('web_search', ctx)
      const doFetch = deps.fetch ?? globalThis.fetch
      const now = (deps.now ?? (() => new Date()))()
      const apiKey = ctx.creds.SERPER_API_KEY
      if (!apiKey) throw new SourceAuthError('SERPER_API_KEY is missing')

      // Company/IPO phrases: the first two multi-word English phrases (never a bare 'jio').
      const phrases = ctx.terms.ipo_terms.filter((t) => /^[\x20-\x7E]+$/.test(t) && /ipo/i.test(t))
      const queries = buildQueries(phrases)
      const tbs = now.getTime() - ctx.since.getTime() > 2 * DAY_MS ? 'qdr:w' : 'qdr:d'

      const posts: NormalizedPost[] = []
      const seen = new Set<string>()
      const errors: string[] = []
      let sent = 0
      for (const q of queries) {
        ctx.signal.throwIfAborted()
        sent += 1
        const res = await doFetch(SERPER_URL, {
          method: 'POST',
          headers: {
            'X-API-KEY': apiKey,
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({ q, gl: 'in', hl: 'en', num: 20, tbs }),
          signal: ctx.signal,
        })
        if (res.status === 401 || res.status === 403) {
          throw new SourceAuthError(`Serper rejected the API key (HTTP ${res.status})`)
        }
        if (res.status === 429) {
          throw new RateLimitedError('Serper rate limited', new Date(now.getTime() + 15 * 60_000))
        }
        if (!res.ok) {
          errors.push(`${q}: HTTP ${res.status}`)
          continue
        }
        const data = (await res.json()) as { organic?: SerperResult[] }
        for (const r of data.organic ?? []) {
          const url = r.link ? parseUrl(r.link) : null
          if (!url || !r.title) continue
          const publishedAt = parseSerperDate(r.date, now)
          if (publishedAt < ctx.since) continue
          const externalId = `ws:${hash16(normalizeLink(url))}`
          if (seen.has(externalId)) continue
          seen.add(externalId)
          const title = r.title.trim()
          const snippet = (r.snippet ?? '').trim()
          posts.push({
            sourceKey: 'web_search',
            externalId,
            url: r.link!,
            author: authorFor(url),
            text: snippet ? `${title}\n\n${snippet}` : title,
            publishedAt,
            reachRaw: {},
            rawJson: { query: q, result: r },
          })
        }
      }
      if (errors.length === queries.length) {
        throw new Error(`All web search queries failed: ${errors.join('; ')}`)
      }
      return { posts, costUsd: sent * SERPER_COST_PER_QUERY_USD }
    },
  }
}

export default createWebSearchAdapter()
