// Shared parsing for the three IPO portals (Chittorgarh, InvestorGain, IPOWatch). Tables are found
// by their header text, never by position or CSS class, so cosmetic changes survive and a real
// layout change raises SourceParseError (which the circuit breaker counts) instead of a wrong number.
import { createHash } from 'node:crypto'
import { load, type CheerioAPI } from 'cheerio'
import {
  compileMatcher,
  type FetchContext,
  type FetchResult,
  type Lane,
  type MarketSeries,
  type Matcher,
  type NormalizedMarketPoint,
  type NormalizedPost,
  type SourceAdapter,
  type SourceKey,
} from '@jio/core'
import { RateLimitedError, SourceParseError } from '../breaker'
import { readFixtureText } from './_fixture'

export const ISSUER_ROW_PATTERN = /\bjio\s*platforms?\b|\breliance\s+jio\b/i
export const ISSUER_EXCLUDE_PATTERN = /jio\s*financial|\bjfsl?\b/i

export const PORTAL_USER_AGENT = 'jio-ipo-analysis/0.1 (+internal research)'
const RATE_LIMIT_PAUSE_MS = 30 * 60_000
const MIN_NEWS_CHARS = 25

const BOUNDS: Record<MarketSeries, [number, number]> = {
  gmp_inr: [-5000, 5000],
  sub_qib_x: [0, 5000],
  sub_nii_x: [0, 5000],
  sub_retail_x: [0, 5000],
  sub_total_x: [0, 5000],
}

export function withinBounds(series: MarketSeries, value: number): boolean {
  const [lo, hi] = BOUNDS[series]
  return Number.isFinite(value) && value >= lo && value <= hi
}

/** '₹45 (12.50%)' -> 45, 'Rs. 1,250' -> 1250, '12.34x' -> 12.34, '--' / 'NA' / '' -> null. */
export function parseNumber(raw: string): number | null {
  let s = raw.replace(/\(.*$/s, '').replace(/[−–—]/g, '-')
  s = s.replace(/₹|rs\.?|inr|times|x|,/gi, '').replace(/\s+/g, '')
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

export interface ParsedTable {
  /** Lower-cased, whitespace-collapsed header cells. */
  headers: string[]
  /** Body rows as trimmed cell text. */
  rows: string[][]
}

/**
 * The first table whose header cells match every required pattern (and `accept`, when given).
 * The header is the first row, whether its cells are th or td.
 */
export function findTable(
  $: CheerioAPI,
  required: RegExp[],
  accept?: (headers: string[]) => boolean,
): ParsedTable | null {
  for (const table of $('table').toArray()) {
    const all = $(table)
      .find('tr')
      .toArray()
      .map((tr) =>
        $(tr)
          .children('th,td')
          .toArray()
          .map((c) => clean($(c).text())),
      )
      .filter((cells) => cells.length > 0)
    const head = all[0]
    if (!head) continue
    const headers = head.map((h) => h.toLowerCase())
    if (!required.every((re) => headers.some((h) => re.test(h)))) continue
    if (accept && !accept(headers)) continue
    return { headers, rows: all.slice(1) }
  }
  return null
}

export type ColumnKind = 'name' | 'gmp' | 'qib' | 'nii' | 'retail' | 'total'

const COLUMN_TIERS: Record<ColumnKind, RegExp[]> = {
  name: [/name|company|ipo/],
  gmp: [/\bgmp\b/],
  qib: [/\bqib\b/],
  nii: [/^nii\b/, /^hni\b/, /\bhni\b/],
  retail: [/^(retail|rii)\b/, /retail|\brii\b/],
  total: [/^(total|overall)\b/, /total|overall/],
}
const COLUMN_EXCLUDE: Partial<Record<ColumnKind, RegExp>> = {
  name: /gmp|price|date|open|close|lot/,
  gmp: /%|est|listing|kostak|sauda|percent/,
}

/** Index of the header for `kind` (best tier first), or -1. `override` is tried before the defaults. */
export function pickColumn(headers: string[], kind: ColumnKind, override?: RegExp): number {
  const tiers = override ? [override, ...COLUMN_TIERS[kind]] : COLUMN_TIERS[kind]
  const exclude = COLUMN_EXCLUDE[kind]
  for (const re of tiers) {
    const idx = headers.findIndex((h) => re.test(h) && !(exclude && exclude.test(h)))
    if (idx >= 0) return idx
  }
  return -1
}

export const matchesIssuer = (name: string) =>
  ISSUER_ROW_PATTERN.test(name) && !ISSUER_EXCLUDE_PATTERN.test(name)

export function findIssuerRow(rows: string[][], nameIndex: number): string[] | null {
  return rows.find((r) => matchesIssuer(r[nameIndex] ?? '')) ?? null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const IST_OFFSET_MIN = 330
const DATE_TIME =
  /(\d{1,2})[-\s/]+([A-Za-z]{3,9})[-\s/,]*(\d{4})[,\s]+(\d{1,2}):(\d{2})\s*(AM|PM)?/i

/** Reads 'Last Updated: 16-Oct-2026 14:05' or '16 Oct 2026, 2:05 PM' as IST; falls back to `now`. */
export function parseObservedAt(text: string, now: Date): Date {
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/)
  if (iso) {
    const d = new Date(iso[0])
    if (!Number.isNaN(d.getTime())) return d
  }
  const at = text.search(/updated/i)
  const m = (at >= 0 ? text.slice(at) : text).match(DATE_TIME) ?? text.match(DATE_TIME)
  if (!m) return now
  const month = MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase())
  if (month < 0) return now
  let hour = Number(m[4])
  const meridiem = m[6]?.toUpperCase()
  if (meridiem === 'PM' && hour < 12) hour += 12
  if (meridiem === 'AM' && hour === 12) hour = 0
  const ms =
    Date.UTC(Number(m[3]), month, Number(m[1]), hour, Number(m[5])) - IST_OFFSET_MIN * 60_000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? now : d
}

export interface ExtractCtx {
  key: SourceKey
  observedAt: Date
  sourceUrl: string
  overrides?: PortalOverrides
}

export interface PortalOverrides {
  /** Header patterns tried before the defaults, for portals with unusual labels. */
  name?: RegExp
  gmp?: RegExp
}

/** The Jio Platforms GMP. A page with a GMP table but no issuer row (pre-IPO) returns []. */
export function extractGmp($: CheerioAPI, ctx: ExtractCtx): NormalizedMarketPoint[] {
  const nameRe = ctx.overrides?.name
  const gmpRe = ctx.overrides?.gmp
  const table = findTable($, [nameRe ?? /ipo|name|company/, gmpRe ?? /gmp/], (h) => {
    return pickColumn(h, 'name', nameRe) >= 0 && pickColumn(h, 'gmp', gmpRe) >= 0
  })
  if (!table) throw new SourceParseError(`${ctx.key}: GMP table not found`)
  const row = findIssuerRow(table.rows, pickColumn(table.headers, 'name', nameRe))
  if (!row) return []
  const value = parseNumber(row[pickColumn(table.headers, 'gmp', gmpRe)] ?? '')
  if (value === null || !withinBounds('gmp_inr', value)) return []
  return [point('gmp_inr', value, ctx)]
}

const SUB_COLUMNS: [ColumnKind, MarketSeries][] = [
  ['qib', 'sub_qib_x'],
  ['nii', 'sub_nii_x'],
  ['retail', 'sub_retail_x'],
  ['total', 'sub_total_x'],
]

/** Up to four subscription multiples for the Jio Platforms row; a null or out-of-bounds cell is skipped. */
export function extractSubscription($: CheerioAPI, ctx: ExtractCtx): NormalizedMarketPoint[] {
  const nameRe = ctx.overrides?.name
  const table = findTable(
    $,
    [/qib/, /nii|hni/, /retail|rii/, /total|overall/],
    (h) => pickColumn(h, 'name', nameRe) >= 0,
  )
  if (!table) throw new SourceParseError(`${ctx.key}: subscription table not found`)
  const row = findIssuerRow(table.rows, pickColumn(table.headers, 'name', nameRe))
  if (!row) return []
  const out: NormalizedMarketPoint[] = []
  for (const [kind, series] of SUB_COLUMNS) {
    const idx = pickColumn(table.headers, kind)
    const value = idx >= 0 ? parseNumber(row[idx] ?? '') : null
    if (value !== null && withinBounds(series, value)) out.push(point(series, value, ctx))
  }
  return out
}

const point = (series: MarketSeries, value: number, ctx: ExtractCtx): NormalizedMarketPoint => ({
  series,
  value,
  observedAt: ctx.observedAt,
  sourceKey: ctx.key,
  sourceUrl: ctx.sourceUrl,
})

export interface PortalIdentity {
  key: SourceKey
  name: string
  domain: string
}

/** Portal news anchors (25+ chars) that pass the keyword matcher, as media-lane posts. */
export function extractNewsLinks(
  $: CheerioAPI,
  baseUrl: string,
  portal: PortalIdentity,
  matcher: Matcher,
  now: Date,
): NormalizedPost[] {
  const seen = new Set<string>()
  const posts: NormalizedPost[] = []
  for (const a of $('a[href]').toArray()) {
    const text = clean($(a).text())
    if (text.length < MIN_NEWS_CHARS || !matcher(text).relevant) continue
    let href: string
    try {
      const u = new URL($(a).attr('href') ?? '', baseUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      href = u.toString()
    } catch {
      continue
    }
    if (seen.has(href)) continue
    seen.add(href)
    const title = clean($(a).attr('title') ?? '')
    posts.push({
      sourceKey: portal.key,
      externalId: `${portal.key}:${createHash('sha256').update(href).digest('hex').slice(0, 16)}`,
      url: href,
      author: {
        platform: 'portal',
        platformUserId: portal.domain,
        displayName: portal.name,
        kind: 'media_outlet',
      },
      text: title && title !== text ? `${text} ${title}` : text,
      publishedAt: now,
      reachRaw: {},
      rawJson: { href, anchorText: text, title: title || null, portal: portal.key },
    })
  }
  return posts
}

export interface PortalSpec extends PortalIdentity {
  gmpUrl: string
  subscriptionUrl: string
  /** File under apps/worker/fixtures/ served in fixture mode. */
  fixtureFile: string
  overrides?: PortalOverrides
}

export interface PortalDeps {
  fetch?: typeof fetch
  now?: () => Date
}

interface Page {
  html: string
  url: string
}

async function getPage(
  url: string,
  doFetch: typeof fetch,
  signal: AbortSignal,
  now: Date,
): Promise<Page> {
  const res = await doFetch(url, { headers: { 'user-agent': PORTAL_USER_AGENT }, signal })
  if (res.status === 429) {
    throw new RateLimitedError(`HTTP 429 ${url}`, new Date(now.getTime() + RATE_LIMIT_PAUSE_MS))
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return { html: await res.text(), url }
}

/** Builds the SourceAdapter for one portal. Fixture mode parses the saved HTML; live mode makes 2 GETs. */
export function createPortalAdapter(spec: PortalSpec, deps: PortalDeps = {}): SourceAdapter {
  const lane: Lane = 'media'
  return {
    key: spec.key,
    lane,
    requiredCreds: [],
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      ctx.signal.throwIfAborted()
      const now = deps.now?.() ?? new Date()
      let gmpPage: Page
      let subPage: Page
      if (ctx.mode === 'fixture') {
        const html = readFixtureText(spec.fixtureFile)
        gmpPage = { html, url: spec.gmpUrl }
        subPage = { html, url: spec.subscriptionUrl }
      } else {
        const doFetch = deps.fetch ?? globalThis.fetch
        gmpPage = await getPage(spec.gmpUrl, doFetch, ctx.signal, now)
        subPage = await getPage(spec.subscriptionUrl, doFetch, ctx.signal, now)
      }
      const $gmp = load(gmpPage.html)
      const $sub = gmpPage.html === subPage.html ? $gmp : load(subPage.html)
      const base = { key: spec.key, overrides: spec.overrides }
      const marketPoints = [
        ...extractGmp($gmp, {
          ...base,
          observedAt: parseObservedAt($gmp('body').text(), now),
          sourceUrl: gmpPage.url,
        }),
        ...extractSubscription($sub, {
          ...base,
          observedAt: parseObservedAt($sub('body').text(), now),
          sourceUrl: subPage.url,
        }),
      ]
      const matcher = compileMatcher(ctx.terms)
      const posts = extractNewsLinks($gmp, gmpPage.url, spec, matcher, now)
      if ($sub !== $gmp) {
        const have = new Set(posts.map((p) => p.externalId))
        for (const p of extractNewsLinks($sub, subPage.url, spec, matcher, now)) {
          if (!have.has(p.externalId)) posts.push(p)
        }
      }
      return { posts, marketPoints, costUsd: 0 }
    },
  }
}
