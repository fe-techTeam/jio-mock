import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type TermsConfig } from './config-schema'
import { compileMatcher, matchTerms, normalizeForMatch, type MatchResult } from './matcher'

const terms = DEFAULT_CONFIG.terms
const match = compileMatcher(terms)

describe('normalizeForMatch', () => {
  it('lowercases, maps - and _ to spaces, collapses whitespace', () => {
    expect(normalizeForMatch('  Jio-IPO__GMP \n kitna  ')).toBe('jio ipo gmp kitna')
  })
  it('applies NFKC and strips zero-width characters', () => {
    expect(normalizeForMatch('\uFF2A\uFF49\uFF4F\u200B IPO\uFEFF')).toBe('jio ipo')
    expect(normalizeForMatch('जि\u200Dयो')).toBe('जियो')
  })
  it('handles empty input', () => {
    expect(normalizeForMatch('')).toBe('')
  })
})

const NOT_RELEVANT: [string, MatchResult['reason']][] = [
  ['jio', 'none'],
  ['Jio yaar, aaj ka match dekha', 'none'],
  ['jio jio jio', 'none'],
  ['जियो', 'none'],
  ['જિયો', 'none'],
  ['jio aur jeene do', 'negative'],
  ['khul ke jio yaar', 'negative'],
  ['जियो और जीने दो', 'negative'],
  ['JioHotstar new season', 'negative'],
  ['JioStar IPO soon?', 'negative'],
  ['Jio Financial Services listing gains', 'negative'],
  ['JFS results today', 'negative'],
  ['Ambani wedding photos', 'none'],
  ['Reliance Retail new store', 'none'],
  ['#IPO #GMP today', 'none'],
  ['#Reliance', 'none'],
  ['jiomart sale today', 'none'],
  ['जियोगे तो देखोगे', 'none'],
  ['जियों आईपीओ', 'none'], // anusvara is a combining mark, so 'जियो' has no boundary
  ['IPO GMP listing allotment', 'none'],
  ['', 'none'],
]

const RELEVANT: [string, MatchResult['reason']][] = [
  ['Jio IPO GMP kitna', 'strong'],
  ['JIO IPO kab aayega', 'strong'],
  ['Jio-IPO', 'strong'],
  ['#JioIPO apply or avoid?', 'strong'],
  ['#jio_ipo', 'strong'],
  ['Reliance Jio IPO price band', 'strong'],
  ['Mukesh Ambani on the Jio Platforms listing', 'strong'],
  ['Isha Ambani speech', 'strong'],
  ['jio ka GMP 120 chal raha', 'anchor_cooccurrence'],
  ['जियो आईपीओ का जीएमपी', 'strong'],
  ['જિયો આઈપીઓ ક્યારે', 'strong'],
  ['Ambani jio announcement', 'anchor_pair'],
  ['RIL shareholder quota for Jio', 'anchor_cooccurrence'],
  ['JFS is not it, Jio IPO is', 'strong'],
  ['jio #RelianceIPO', 'anchor_cooccurrence'],
  ['JioStar spin-off after the Jio IPO', 'strong'],
  ['जियो का आईपीओ कब आएगा', 'strong'],
  ['Reliance IPO allotment kab', 'anchor_cooccurrence'],
  ['#RIL #GMP', 'anchor_cooccurrence'],
  ['अंबानी आईपीओ', 'anchor_cooccurrence'],
  ['#MukeshAmbani', 'strong'],
  ['RJIL results', 'strong'],
]

describe('matcher against DEFAULT_CONFIG.terms', () => {
  it.each(NOT_RELEVANT)('not relevant: %j (%s)', (text, reason) => {
    const r = match(text)
    expect(r.relevant).toBe(false)
    expect(r.reason).toBe(reason)
    expect(r.matchedTerms).toEqual([])
  })

  it.each(RELEVANT)('relevant: %j (%s)', (text, reason) => {
    const r = match(text)
    expect(r.relevant).toBe(true)
    expect(r.reason).toBe(reason)
    expect(r.matchedTerms.length).toBeGreaterThan(0)
  })

  it('reports the negative terms it masked', () => {
    expect(match('JioStar IPO soon?').negativeHits).toEqual(['JioStar'])
    expect(match('Jio Financial Services listing gains').negativeHits).toEqual([
      'Jio Financial Services',
    ])
    expect(match('JFS is not it, Jio IPO is')).toMatchObject({
      relevant: true,
      negativeHits: ['JFS'],
    })
  })

  it('keeps the original config spelling in matchedTerms', () => {
    expect(match('JIO IPO kab aayega').matchedTerms).toEqual(['Jio IPO'])
    expect(match('#jioipo').matchedTerms).toContain('#JioIPO')
    expect(match('jio ka GMP 120 chal raha').matchedTerms).toEqual(['jio', 'GMP'])
  })

  it('does not let a generic hashtag qualify the anchor inside itself', () => {
    expect(match('#Reliance').relevant).toBe(false)
    expect(match('#RIL').relevant).toBe(false)
    expect(match('#Ambani').relevant).toBe(false)
  })
})

describe('entities', () => {
  it('needs the full alias span', () => {
    expect(match('Mukesh and Akash Ambani').entities).toEqual(['akash'])
  })
  it('returns keys in ENTITY_KEYS order', () => {
    expect(match('Mukesh Ambani, Isha Ambani at Jio IPO').entities).toEqual([
      'mukesh',
      'isha',
      'jio',
    ])
    expect(match('Jio IPO: Isha Ambani and Mukesh Ambani').entities).toEqual([
      'mukesh',
      'isha',
      'jio',
    ])
  })
  it('adds jio for ipo-term and jio-anchor relevance, not for Ambani-only relevance', () => {
    expect(match('jio ka GMP 120 chal raha').entities).toEqual(['jio'])
    expect(match('#JioIPO apply or avoid?').entities).toEqual(['jio'])
    expect(match('Reliance IPO allotment kab').entities).toEqual([])
    expect(match('अंबानी आईपीओ').entities).toEqual([])
  })
  it('does not treat a person hashtag as a Jio mention', () => {
    expect(match('#MukeshAmbani').entities).toEqual(['mukesh'])
  })
  it('is empty when not relevant', () => {
    expect(match('JioHotstar new season').entities).toEqual([])
  })
})

describe('matchTerms', () => {
  it('matches like compileMatcher and caches per terms object', () => {
    expect(matchTerms('Jio IPO GMP kitna', terms)).toEqual(match('Jio IPO GMP kitna'))
    expect(matchTerms('jio', terms).relevant).toBe(false)
  })
  it('recompiles for a different terms object', () => {
    const custom: TermsConfig = { ...terms, ipo_terms: [...terms.ipo_terms, 'Jio mega issue'] }
    expect(matchTerms('Jio mega issue', terms).relevant).toBe(false)
    expect(matchTerms('Jio mega issue', custom)).toMatchObject({
      relevant: true,
      reason: 'strong',
    })
  })
  it('escapes regex metacharacters in terms', () => {
    const custom: TermsConfig = { ...terms, ipo_terms: ['Jio (IPO)+', 'a.b'] }
    expect(matchTerms('jio (ipo)+ now', custom).relevant).toBe(true)
    expect(matchTerms('axb', custom).relevant).toBe(false)
  })
  it('works with empty term lists', () => {
    const empty: TermsConfig = {
      ipo_terms: [],
      hashtags: [],
      generic_hashtags: [],
      entities: {
        mukesh: { label: 'M', aliases: ['zzmukesh'] },
        akash: { label: 'A', aliases: ['zzakash'] },
        isha: { label: 'I', aliases: ['zzisha'] },
        jio: { label: 'J', aliases: ['zzjio'] },
      },
      anchor_groups: [],
      cooccurrence_terms: [],
      negative_terms: [],
    }
    expect(matchTerms('Jio IPO', empty)).toMatchObject({ relevant: false, reason: 'none' })
  })
})

describe('robustness', () => {
  it('never throws on very long input and truncates to 20,000 chars', () => {
    const long = 'jio '.repeat(50_000)
    expect(() => match(long)).not.toThrow()
    expect(match('x'.repeat(20_000) + ' Jio IPO').relevant).toBe(false)
    expect(match('Jio IPO ' + 'x '.repeat(30_000)).relevant).toBe(true)
  })

  it('compiles and matches 5,000 mixed texts in under 2s', () => {
    const samples = [...NOT_RELEVANT, ...RELEVANT].map(([t]) => t)
    const texts = Array.from(
      { length: 5000 },
      (_, i) => `${samples[i % samples.length]} post ${i} ${'filler words here '.repeat(i % 20)}`,
    )
    const t0 = Date.now()
    const m = compileMatcher(structuredClone(terms))
    let relevant = 0
    for (const t of texts) if (m(t).relevant) relevant++
    const elapsed = Date.now() - t0
    expect(relevant).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(2000)
  })
})
