// Builds js/data.js, the dataset behind the demo. Run from demo/:
//
//   node build-data.mjs [../scraped-output]
//
// Input is ONLY the scraped-output directory (real scraped data merged with the user's CSV extracts):
//   - all-posts.ndjson     every post (one JSON object per line)
//   - manifest.json        run id, window (since/until) and per-source status
//   - <sourceKey>.json     per-source envelopes (fetchedAt, error, cost)
//   - market-points.json   real GMP observations
// Nothing is generated, interpolated or taken from fixtures. Every timestamp is stored as
// "minutes before the run's until time" and resolved against page load, so the demo looks live.
// Classification (topic and sentiment) uses the worker's stub-classifier rules on the real text and
// the real keyword matcher (js/core.js) for entities, so no LLM is needed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const INPUT = process.argv[2] ?? '../scraped-output'
globalThis.JioCore = undefined
require('./js/core.js')
const { compileMatcher, DEFAULT_TERMS, normalizeForMatch } = globalThis.JioCore
const matcher = compileMatcher(DEFAULT_TERMS)

// ---------------------------------------------------------------------------------------------
// Topic and sentiment rules (worker stub classifier: STUB_HINTS, POSITIVE_TERMS, NEGATIVE_TERMS)

const TOPIC_HINTS = [
  ['gmp-grey-market', ['gmp', 'grey market', 'kostak', 'sauda', 'जीएमपी', 'ग्रे मार्केट', 'ગ્રે માર્કેટ']],
  ['valuation-price-band', ['valuation', 'price band', 'expensive', 'overvalued', 'महंगा', '₹1,119', 'crore', 'review', 'worth', 'multiple', 'raise', 'largest', 'biggest', 'प्राइस बैंड', 'कीमत', 'करोड़', 'सबसे बड़ा', 'share price', 'falls', 'टूटा']],
  ['subscription-demand', ['subscribed', 'qib', 'nii', 'hni', 'subscription', 'anchor', 'well received', 'hype', 'craze', 'क्रेज', 'खुलेगा', 'opens', 'index flows', 'pre-ipo']],
  ['allotment-retail-access', ['allotment', 'allot', 'mila', 'अलॉटमेंट', 'એલોટમેન્ટ', 'quota', 'eligible', 'eligibility', 'who can apply', 'nris', 'शेयरहोल्डर्स', 'सवाल']],
  ['listing-expectations', ['listing', 'listing gain', 'लिस्टिंग', 'લિસ્ટિંગ', 'multibagger']],
  ['ambani-family-leadership', ['ambani', 'succession', 'अंबानी', 'અંબાણી', 'akash', 'isha', 'mukesh', 'wealth creation', 'conglomerate', 'kotak', 'कोटक', 'ઉદય કોટક']],
  ['governance-promoter-control', ['governance', 'promoter', 'related party', 'sebi', 'ofs', 'drhp', 'use of proceeds', 'debt']],
  ['telecom-business', ['tariff', '5g', 'arpu', 'subscribers', 'recharge', 'airtel', 'telecom']],
  ['digital-ai-growth', ['ai', 'cloud', 'partnership', 'meta', 'google', 'intel', '6g', 'technology', 'tech', 'digital', 'डिजिटल', 'मेटा', 'गूगल', 'starlink', 'global', 'growth story']],
  ['emerging', ['salary', 'employees', 'workforce', 'पगार', 'પગાર', 'કર્મીઓને', 'कर्मचारियों']],
  ['customer-experience', ['network', 'complaint', 'customer care', 'outage']],
]
const POSITIVE = ['bullish', 'strong', 'apply', 'lagau', 'lagao', 'accha', 'achha', 'great', 'solid', 'rises', 'gains', 'boost', 'record', 'शानदार', 'मजबूत', 'સરસ']
const NEGATIVE = ['overvalued', 'avoid', 'expensive', 'scam', 'loot', 'worst', 'bad', 'weak', 'complaint', 'outage', 'risk', 'falls', 'concern', 'महंगा', 'बेकार', 'ખરાબ']

const has = (text, term) => {
  const t = normalizeForMatch(term)
  const re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{M}\\p{N}])`, 'u')
  return re.test(text)
}
function stubTopic(text) {
  const n = normalizeForMatch(text)
  let best = null
  let bestScore = 0
  for (const [slug, terms] of TOPIC_HINTS) {
    const score = terms.filter((t) => has(n, t)).length
    if (score > bestScore) [best, bestScore] = [slug, score]
  }
  return best
}
function stubSentiment(text) {
  const n = normalizeForMatch(text)
  const p = POSITIVE.filter((t) => has(n, t)).length
  const q = NEGATIVE.filter((t) => has(n, t)).length
  return p > q ? 'positive' : q > p ? 'negative' : 'neutral'
}

// ---------------------------------------------------------------------------------------------
// Load the scraped output

const readJson = (f) => JSON.parse(readFileSync(join(INPUT, f), 'utf8'))
const manifest = readJson('manifest.json')
const marketFile = readJson('market-points.json')
const rawPosts = readFileSync(join(INPUT, 'all-posts.ndjson'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const UNTIL = new Date(manifest.window.until).getTime()
const minutesBefore = (iso) => Math.max(0.5, Math.round(((UNTIL - new Date(iso).getTime()) / 60000) * 10) / 10)

function reachScore(rr) {
  const v = (rr.impressions ?? 0) / 50 + (rr.views ?? 0) / 20 + (rr.likes ?? 0) + 2 * (rr.retweets ?? 0) + (rr.comments ?? 0) * 2 + (rr.upvotes ?? 0) + (rr.followers ?? 0) / 2000
  return Math.max(1, Math.min(100, Math.round(14 * Math.log10(1 + v))))
}

const posts = []
const authors = []
const authorIndex = new Map()
function authorId(a) {
  if (!a) return null
  const key = JSON.stringify(a)
  if (!authorIndex.has(key)) {
    authorIndex.set(key, authors.length)
    authors.push(a)
  }
  return authorIndex.get(key)
}

for (const p of rawPosts) {
  const text = p.sourceKey === 'news_rss' ? p.text.split('\n\n')[0] : p.text
  const topic = stubTopic(text) ?? 'unclassified'
  const lang = /[ऀ-ॿ]/.test(text) ? 'hi' : /[઀-૿]/.test(text) ? 'gu' : 'en'
  const m = matcher(text)
  const a = p.author
  // Person-level privacy rule: only media outlets and public figures are shown by name.
  const visible = a && (a.kind === 'media_outlet' || a.kind === 'public_figure')
  const rr = p.reachRaw ?? {}
  posts.push({
    id: '',
    s: p.sourceKey,
    m: minutesBefore(p.publishedAt),
    u: p.url,
    t: text,
    g: null,
    l: lang,
    tp: topic,
    se: stubSentiment(text),
    e: m.entities.length ? m.entities : topic !== 'unclassified' ? ['jio'] : [],
    c: topic === 'unclassified' ? 'low' : 'high',
    r: reachScore(rr),
    rr,
    a: visible ? authorId({ kind: a.kind, displayName: a.displayName ?? null, handle: a.handle ?? null }) : null,
    ln: p.lane,
    co: 0,
  })
}
posts.sort((a, b) => a.m - b.m)
posts.forEach((p, i) => (p.id = `p${i + 1}`))

const market = marketFile.marketPoints
  .map((p) => ({ series: p.series, value: p.value, m: minutesBefore(p.observedAt), sourceKey: p.sourceKey, sourceUrl: p.sourceUrl }))
  .sort((a, b) => a.m - b.m)

// Per-source run facts, from the manifest and each source's envelope.
const counts = {}
for (const p of posts) counts[p.s] = (counts[p.s] ?? 0) + 1
const sources = manifest.sources.map((s) => {
  const f = join(INPUT, `${s.sourceKey}.json`)
  const env = existsSync(f) ? readJson(f) : null
  return {
    sourceKey: s.sourceKey,
    status: s.status,
    error: s.error ?? null,
    costUsd: s.costUsd ?? 0,
    posts: counts[s.sourceKey] ?? 0,
    fetchedMinutesAgo: env?.fetchedAt ? minutesBefore(env.fetchedAt) : null,
    lane: env?.lane ?? null,
  }
})

const out = {
  note: 'Snapshot of real scraped data plus the user CSV extracts (scraped-output/). Nothing generated.',
  run: { runId: manifest.runId, since: manifest.window.since, until: manifest.window.until, posts: posts.length, marketPoints: market.length },
  sources,
  authors,
  posts,
  market,
}
writeFileSync(new URL('./js/data.js', import.meta.url), `// Generated by build-data.mjs from scraped-output/. Do not edit by hand.\nwindow.SNAPSHOT_DATA = ${JSON.stringify(out)};\n`)
const in24 = posts.filter((p) => p.m <= 1440).length
const prev = posts.filter((p) => p.m > 1440 && p.m <= 2880).length
console.log(`posts ${posts.length}; 24h ${in24}, prior 24h ${prev}; market points ${market.length}; sources ${sources.length}`)
