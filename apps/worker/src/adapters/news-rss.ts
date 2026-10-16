// Live news adapter (02-03): Google News search feeds (en-IN, hi, gu) plus publisher RSS feeds.
// rss-parser's parseString is used (never parseURL) so the injected fetch carries every request.
import * as cheerio from 'cheerio'
import Parser from 'rss-parser'
import {
  compileMatcher,
  type FetchContext,
  type FetchResult,
  type NormalizedPost,
  type SourceAdapter,
  type TermsConfig,
} from '@jio/core'
import { fixtureFetch } from './_fixture'

const USER_AGENT = 'jio-ipo-analysis/0.1 (+internal research)'
const DAY_MS = 86_400_000

export interface PublisherFeed {
  name: string
  url: string
  domain: string
}

/** Best-known publisher feed URLs; verify on the first live run (ISS: publisher feed URLs). */
export const PUBLISHER_FEEDS: PublisherFeed[] = [
  { name: 'Mint markets', url: 'https://www.livemint.com/rss/markets', domain: 'livemint.com' },
  {
    name: 'ETMarkets IPO',
    url: 'https://economictimes.indiatimes.com/markets/ipos/fpos/rssfeeds/14655708.cms',
    domain: 'economictimes.indiatimes.com',
  },
  {
    name: 'ET Markets',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms',
    domain: 'economictimes.indiatimes.com',
  },
  {
    name: 'Moneycontrol IPO',
    url: 'https://www.moneycontrol.com/rss/iponews.xml',
    domain: 'moneycontrol.com',
  },
  {
    name: 'Business Standard markets',
    url: 'https://www.business-standard.com/rss/markets-106.rss',
    domain: 'business-standard.com',
  },
  {
    name: 'Financial Express IPO',
    url: 'https://www.financialexpress.com/market/ipo-news/feed/',
    domain: 'financialexpress.com',
  },
]

type Lang = 'en' | 'hi' | 'gu'

const GN_PARAMS: Record<Lang, { hl: string; ceid: string; name: string }> = {
  en: { hl: 'en-IN', ceid: 'IN:en', name: 'Google News en' },
  hi: { hl: 'hi', ceid: 'IN:hi', name: 'Google News hi' },
  gu: { hl: 'gu', ceid: 'IN:gu', name: 'Google News gu' },
}

const DEVANAGARI = /[ऀ-ॿ]/
const GUJARATI = /[઀-૿]/
const ASCII = /^[\x20-\x7E]+$/

const quote = (s: string) => `"${s.replace(/"/g, '')}"`

/**
 * One query per language: quoted company/IPO phrases OR-ed. Phrases come from ipo_terms, so a bare
 * 'jio' is never a term. `when:` limits the age (7d when since is over 2 days old, else 1d).
 */
export function buildGoogleNewsQueries(
  terms: TermsConfig,
  since: Date = new Date(0),
  now: Date = new Date(),
): { lang: Lang; q: string }[] {
  const when = now.getTime() - since.getTime() > 2 * DAY_MS ? 'when:7d' : 'when:1d'
  const en = terms.ipo_terms
    .filter(
      (t) => ASCII.test(t) && /ipo|platforms|reliance jio/i.test(t) && t.split(' ').length > 1,
    )
    .filter((t) => !/\b(lagau|karu|ka|lena|kab)\b/i.test(t))
    .slice(0, 6)
  const hi = terms.ipo_terms.filter((t) => DEVANAGARI.test(t) && /आईपीओ/.test(t)).slice(0, 3)
  const gu = terms.ipo_terms.filter((t) => GUJARATI.test(t) && /આઈપીઓ|IPO/.test(t)).slice(0, 3)
  const mk = (lang: Lang, phrases: string[]) => ({
    lang,
    q: `${phrases.map(quote).join(' OR ')} ${when}`,
  })
  return [mk('en', en), mk('hi', hi), mk('gu', gu)]
}

function googleNewsUrl(lang: Lang, q: string): string {
  const p = GN_PARAMS[lang]
  const qs = new URLSearchParams({ q, hl: p.hl, gl: 'IN', ceid: p.ceid })
  return `https://news.google.com/rss/search?${qs.toString()}`
}

function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return cheerio.load(`<div>${html}</div>`).text().replace(/\s+/g, ' ').trim()
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

type FeedItem = {
  title?: string
  link?: string
  guid?: string
  pubDate?: string
  isoDate?: string
  content?: string
  contentSnippet?: string
  source?: unknown
}

function sourceName(source: unknown): string | undefined {
  if (typeof source === 'string') return source.trim() || undefined
  if (source && typeof source === 'object' && '_' in source) {
    const v = (source as { _?: unknown })._
    return typeof v === 'string' ? v.trim() || undefined : undefined
  }
  return undefined
}

/** rss-parser drops attributes, so the Google News `<source url>` domains are read separately. */
function sourceDomains(xml: string): (string | undefined)[] {
  const $ = cheerio.load(xml, { xmlMode: true })
  return $('item')
    .map((_i, el) => hostOf($(el).children('source').attr('url')) ?? '')
    .get()
    .map((d) => d || undefined)
}

function itemText(title: string, snippet: string): string {
  return snippet && snippet !== title ? `${title}\n\n${snippet}` : title
}

export function createNewsRssAdapter(
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): SourceAdapter {
  return {
    key: 'news_rss',
    lane: 'media',
    requiredCreds: [],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      if (ctx.mode === 'fixture') return fixtureFetch('news_rss', ctx)
      const doFetch = deps.fetch ?? globalThis.fetch
      const now = (deps.now ?? (() => new Date()))()
      const matcher = compileMatcher(ctx.terms)
      const parser = new Parser<Record<string, never>, FeedItem>({
        customFields: { item: ['source'] },
      })

      const load = async (url: string) => {
        const res = await doFetch(url, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/rss+xml, application/xml, text/xml',
          },
          signal: ctx.signal,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.text()
        return { body, feed: await parser.parseString(body) }
      }

      const toDate = (item: FeedItem): Date | null => {
        const raw = item.isoDate ?? item.pubDate
        if (!raw) return now
        const d = new Date(raw)
        return Number.isNaN(d.getTime()) ? now : d
      }

      const jobs: { name: string; run: () => Promise<NormalizedPost[]> }[] = []

      for (const { lang, q } of buildGoogleNewsQueries(ctx.terms, ctx.since, now)) {
        jobs.push({
          name: GN_PARAMS[lang].name,
          run: async () => {
            const { body, feed } = await load(googleNewsUrl(lang, q))
            const domains = sourceDomains(body)
            const out: NormalizedPost[] = []
            feed.items.forEach((item, i) => {
              const title = (item.title ?? '').trim()
              const link = item.link ?? ''
              const id = item.guid ?? link
              const publishedAt = toDate(item)
              if (!title || !id || !publishedAt || publishedAt < ctx.since) return
              const name = sourceName(item.source)
              const domain = domains[i] ?? hostOf(link) ?? 'news.google.com'
              out.push({
                sourceKey: 'news_rss',
                externalId: `gn:${id}`,
                url: link,
                author: {
                  platform: 'news',
                  platformUserId: domain,
                  displayName: name ?? domain,
                  kind: 'media_outlet',
                },
                text: itemText(title, stripHtml(item.content)),
                publishedAt,
                reachRaw: {},
                rawJson: { feed: GN_PARAMS[lang].name, lang, item },
              })
            })
            return out
          },
        })
      }

      for (const pub of PUBLISHER_FEEDS) {
        jobs.push({
          name: pub.name,
          run: async () => {
            const { feed } = await load(pub.url)
            const out: NormalizedPost[] = []
            for (const item of feed.items) {
              const title = (item.title ?? '').trim()
              const link = item.link ?? ''
              const id = item.guid ?? link
              const publishedAt = toDate(item)
              if (!title || !id || !publishedAt || publishedAt < ctx.since) continue
              const text = itemText(title, stripHtml(item.content))
              if (!matcher(text).relevant) continue
              out.push({
                sourceKey: 'news_rss',
                externalId: `pub:${id}`,
                url: link,
                author: {
                  platform: 'news',
                  platformUserId: pub.domain,
                  displayName: pub.name,
                  kind: 'media_outlet',
                },
                text,
                publishedAt,
                reachRaw: {},
                rawJson: { feed: pub.name, item },
              })
            }
            return out
          },
        })
      }

      const settled = await Promise.allSettled(jobs.map((j) => j.run()))
      const failures: string[] = []
      const seen = new Set<string>()
      const posts: NormalizedPost[] = []
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          const reason = r.reason instanceof Error ? r.reason.message : String(r.reason)
          failures.push(`${jobs[i]!.name} (${reason})`)
          return
        }
        for (const p of r.value) {
          if (seen.has(p.externalId)) continue
          seen.add(p.externalId)
          posts.push(p)
        }
      })
      if (failures.length === jobs.length) {
        ctx.signal.throwIfAborted()
        throw new Error(`All news feeds failed: ${failures.join('; ')}`)
      }
      return { posts, costUsd: 0 }
    },
  }
}

export default createNewsRssAdapter()
