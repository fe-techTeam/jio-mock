// Deterministic keyword classifier used whenever ANTHROPIC_API_KEY is empty (every test and every
// fixture-mode run). It is deliberately simple: term counts per topic, two small sentiment
// lexicons and the configured entity aliases. Output goes through normalizeResult like the model's.
import { ENTITY_KEYS, normalizeForMatch } from '@jio/core'
import type { EntityKey, TermsConfig, TopicDef } from '@jio/core'
import { classifiableTopics, normalizeResult } from './classifier'
import type { Classifier, ClassifierInput, ClassifyResult } from './classifier'

export const STUB_MODEL = 'stub-v1'

/** Extra terms per topic, keyed by a regex over the topic name so slug changes do not break it. */
export const STUB_HINTS: { name: RegExp; terms: string[] }[] = [
  {
    name: /\bgmp\b|\bgrey\b/,
    terms: ['gmp', 'grey market', 'kostak', 'sauda', 'जीएमपी', 'ग्रे मार्केट', 'ગ્રે માર્કેટ'],
  },
  {
    name: /\bvaluation\b|\bprice band\b/,
    terms: ['valuation', 'price band', 'expensive', 'overvalued', 'महंगा'],
  },
  { name: /\bsubscription\b/, terms: ['subscribed', 'qib', 'nii', 'hni', 'subscription'] },
  {
    name: /\ballotment\b/,
    terms: ['allotment', 'allot', 'mila', 'अलॉटमेंट', 'એલોટમેન્ટ', 'quota'],
  },
  { name: /\blisting\b/, terms: ['listing', 'listing gain', 'लिस्टिंग', 'લિસ્ટિંગ'] },
  { name: /\bambani\b|\bsuccession\b/, terms: ['ambani', 'succession', 'अंबानी', 'અંબાણી'] },
  { name: /\bgovernance\b/, terms: ['governance', 'promoter', 'related party', 'sebi'] },
  { name: /\btelecom\b|\btariffs?\b/, terms: ['tariff', '5g', 'arpu', 'subscribers', 'recharge'] },
  { name: /\bdigital\b|\bai\b/, terms: ['ai', 'cloud', 'platform', 'partnership'] },
  {
    name: /\bcustomer\b|\bcomplaints?\b/,
    terms: ['network', 'complaint', 'customer care', 'outage'],
  },
]

export const POSITIVE_TERMS = [
  'bullish',
  'strong',
  'apply',
  'lagau',
  'lagao',
  'accha',
  'achha',
  'great',
  'solid',
  'शानदार',
  'मजबूत',
  'સરસ',
]
export const NEGATIVE_TERMS = [
  'overvalued',
  'avoid',
  'expensive',
  'scam',
  'loot',
  'worst',
  'bad',
  'weak',
  'complaint',
  'outage',
  'महंगा',
  'बेकार',
  'ખરાબ',
]

/** 'jio' is tagged for a company alias or one of these IPO phrases, never for a bare 'jio'. */
const JIO_IPO_PHRASES = ['jio ipo', 'जियो आईपीओ', 'જિયો આઈપીઓ']

const GLOSS_SOURCE_CHARS = 100
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const WORD_SPLIT = /[^\p{L}\p{M}\p{N}]+/u

const termRes = new Map<string, RegExp | null>()

/** Whole-term test on normalized text, with Unicode letter/mark/number boundaries. */
function contains(text: string, term: string): boolean {
  let re = termRes.get(term)
  if (re === undefined) {
    const t = normalizeForMatch(term)
    re = t
      ? new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{M}\\p{N}])`, 'u')
      : null
    if (termRes.size > 5000) termRes.clear()
    termRes.set(term, re)
  }
  return re !== null && re.test(text)
}

function topicTerms(topic: TopicDef): string[] {
  const name = normalizeForMatch(topic.name)
  const terms = new Set<string>()
  for (const p of topic.examplePhrases) terms.add(normalizeForMatch(p))
  for (const w of name.split(WORD_SPLIT)) if (w.length > 3) terms.add(w)
  for (const h of STUB_HINTS) {
    if (h.name.test(name)) for (const t of h.terms) terms.add(normalizeForMatch(t))
  }
  terms.delete('')
  return [...terms]
}

const countHits = (text: string, terms: string[]) => terms.filter((t) => contains(text, t)).length

export class StubClassifier implements Classifier {
  readonly model = STUB_MODEL
  readonly promptVersion = STUB_MODEL
  private readonly terms: TermsConfig

  constructor(opts: { terms: TermsConfig }) {
    this.terms = opts.terms
  }

  async classify(items: ClassifierInput[], topics: TopicDef[]): Promise<ClassifyResult[]> {
    const candidates = classifiableTopics(topics).map((t) => ({
      slug: t.slug,
      terms: topicTerms(t),
    }))
    const validSlugs = new Set(candidates.map((c) => c.slug))
    return items.map((item) =>
      normalizeResult(this.label(item, candidates), item.postId, validSlugs),
    )
  }

  private label(item: ClassifierInput, candidates: { slug: string; terms: string[] }[]) {
    const text = normalizeForMatch(item.text ?? '')

    let best: { slug: string; score: number } | null = null
    for (const c of candidates) {
      const score = countHits(text, c.terms)
      if (score > 0 && (!best || score > best.score)) best = { slug: c.slug, score }
    }

    const balance = countHits(text, POSITIVE_TERMS) - countHits(text, NEGATIVE_TERMS)
    const sentiment = balance > 0 ? 'positive' : balance < 0 ? 'negative' : 'neutral'

    const entities: EntityKey[] = ENTITY_KEYS.filter((key) => {
      const aliases = this.terms.entities[key].aliases
      const extra = key === 'jio' ? JIO_IPO_PHRASES : []
      return [...aliases, ...extra].some((a) => contains(text, a))
    })

    const gloss =
      item.lang === 'en'
        ? ''
        : '[stub] ' +
          Array.from(item.text ?? '')
            .slice(0, GLOSS_SOURCE_CHARS)
            .join('')

    return {
      topic: best && text !== '' ? best.slug : 'unclassified',
      sentiment,
      entities,
      confidence: best && best.score >= 1 && text !== '' ? 'high' : 'low',
      gloss_en: gloss,
    }
  }
}
