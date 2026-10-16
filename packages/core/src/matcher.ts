// Keyword relevance matcher: the main noise filter before any LLM sees a post.
//
// Lists (all in TermsConfig, so the rules are data, not code):
// - strong: ipo_terms, hashtags and entity aliases match alone;
// - anchors: ambiguous words grouped by meaning ('jio' means 'live' in Hindi); an anchor needs a
//   qualifier (cooccurrence_terms or generic_hashtags) or an anchor from a second group;
// - negative_terms are masked out before anything else, so 'JioStar IPO' leaves only 'IPO'.
import type { TermsConfig } from './config-schema'
import { ENTITY_KEYS, type EntityKey } from './types'

export type MatchResult = {
  relevant: boolean
  reason: 'strong' | 'anchor_cooccurrence' | 'anchor_pair' | 'negative' | 'none'
  /** Original config spellings of the hits behind `reason`, in text order; [] when not relevant. */
  matchedTerms: string[]
  entities: EntityKey[]
  /** Original config spellings of the negative terms found (and masked). */
  negativeHits: string[]
}

export type Matcher = (text: string) => MatchResult

const MAX_INPUT_CHARS = 20_000
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Hit = { start: number; end: number; term: string; tag: string }

type CompiledList = { re: RegExp; lookup: Map<string, { term: string; tag: string }> } | null

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** One alternation per list, longest terms first, with Unicode letter/mark/number boundaries. */
function compileList(entries: { term: string; tag: string }[]): CompiledList {
  const lookup = new Map<string, { term: string; tag: string }>()
  for (const e of entries) {
    const key = normalizeForMatch(e.term)
    if (key && !lookup.has(key)) lookup.set(key, e)
  }
  if (lookup.size === 0) return null
  const alts = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  const re = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
    'giu',
  )
  return { re, lookup }
}

function findHits(list: CompiledList, text: string): Hit[] {
  if (!list) return []
  const hits: Hit[] = []
  for (const m of text.matchAll(list.re)) {
    const info = list.lookup.get(m[0].toLowerCase())
    if (!info || m.index === undefined) continue
    hits.push({ start: m.index, end: m.index + m[0].length, term: info.term, tag: info.tag })
  }
  return hits
}

const overlaps = (a: Hit, b: Hit) => a.start < b.end && b.start < a.end

/** Unique original spellings in text order. */
function termsInOrder(hits: Hit[]): string[] {
  const out: string[] = []
  for (const h of [...hits].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (!out.includes(h.term)) out.push(h.term)
  }
  return out
}

const tagged = (terms: string[], tag: string) => terms.map((term) => ({ term, tag }))

export function compileMatcher(terms: TermsConfig): Matcher {
  const negatives = compileList(tagged(terms.negative_terms, 'negative'))
  const strong = compileList([
    ...tagged(terms.ipo_terms, 'ipo_terms'),
    ...tagged(terms.hashtags, 'hashtags'),
  ])
  const entityLists = ENTITY_KEYS.map(
    (key) => [key, compileList(tagged(terms.entities[key].aliases, key))] as const,
  )
  const anchors = compileList(terms.anchor_groups.flatMap((g) => tagged(g.terms, g.name)))
  const qualifiers = compileList([
    ...tagged(terms.cooccurrence_terms, 'cooccurrence'),
    ...tagged(terms.generic_hashtags, 'generic_hashtag'),
  ])

  return (input: string): MatchResult => {
    const text = normalizeForMatch(String(input ?? '').slice(0, MAX_INPUT_CHARS))

    // (1) mask negative spans with same-length blanks so offsets stay valid
    const negHits = findHits(negatives, text)
    let masked = text
    for (const h of negHits) {
      masked = masked.slice(0, h.start) + ' '.repeat(h.end - h.start) + masked.slice(h.end)
    }
    const negativeHits = termsInOrder(negHits)

    // (2) strong hits
    const strongHits = findHits(strong, masked)
    const entityHits = entityLists.flatMap(([, list]) => findHits(list, masked))

    // (3) anchors, and qualifiers that are not part of an anchor's own span ('#Reliance')
    const anchorHits = findHits(anchors, masked)
    const qualifierHits = findHits(qualifiers, masked).filter(
      (q) => !anchorHits.some((a) => overlaps(a, q)),
    )

    // (4) decide
    let reason: MatchResult['reason']
    let because: Hit[]
    const anchorGroups = new Set(anchorHits.map((h) => h.tag))
    if (strongHits.length > 0 || entityHits.length > 0) {
      reason = 'strong'
      because = [...strongHits, ...entityHits]
    } else if (anchorHits.length > 0 && qualifierHits.length > 0) {
      reason = 'anchor_cooccurrence'
      because = [...anchorHits, ...qualifierHits]
    } else if (anchorGroups.size >= 2) {
      reason = 'anchor_pair'
      because = anchorHits
    } else {
      // (5)
      return {
        relevant: false,
        reason: negativeHits.length > 0 ? 'negative' : 'none',
        matchedTerms: [],
        entities: [],
        negativeHits,
      }
    }

    // Entities: alias hits, plus 'jio' for an ipo_terms/hashtags hit (unless it is just a person
    // tag such as #MukeshAmbani) or a jio-group anchor that took part in the decision.
    const found = new Set<EntityKey>(entityHits.map((h) => h.tag as EntityKey))
    const personHits = entityHits.filter((h) => h.tag !== 'jio')
    const jioByStrong = strongHits.some((h) => !personHits.some((p) => overlaps(p, h)))
    const jioByAnchor = reason !== 'strong' && anchorGroups.has('jio')
    if (jioByStrong || jioByAnchor) found.add('jio')

    return {
      relevant: true,
      reason,
      matchedTerms: termsInOrder(because),
      entities: ENTITY_KEYS.filter((k) => found.has(k)),
      negativeHits,
    }
  }
}

const cache = new WeakMap<TermsConfig, Matcher>()

/** Matches with a matcher compiled once per terms object (cached by identity). */
export function matchTerms(text: string, terms: TermsConfig): MatchResult {
  let m = cache.get(terms)
  if (!m) {
    m = compileMatcher(terms)
    cache.set(terms, m)
  }
  return m(text)
}
