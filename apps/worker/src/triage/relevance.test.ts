import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import { assessRelevance } from './relevance'

const terms = DEFAULT_CONFIG.terms

describe('assessRelevance (DEFAULT_CONFIG.terms)', () => {
  // The brew spec lists these Hindi 'live' phrases as seed negative terms dropped at triage, so
  // the matcher reports them as negative_term; the guarantee is that they are never relevant.
  it.each(['jio aur jeene do', 'khul ke jio yaar', 'जियो और जीने दो'])(
    '%s is not relevant',
    (text) => {
      const r = assessRelevance(text, terms)
      expect(r.relevant).toBe(false)
      expect(['no_match', 'negative_term']).toContain(r.reason)
      expect(r.matchedTerms).toEqual([])
    },
  )

  it.each([
    'Jio IPO GMP kitna',
    'Reliance Jio IPO price band',
    'Mukesh Ambani on the Jio Platforms listing',
    '#JioIPO apply or avoid?',
  ])('%s matches', (text) => {
    const r = assessRelevance(text, terms)
    expect(r).toMatchObject({ relevant: true, reason: 'match' })
    expect(r.matchedTerms.length).toBeGreaterThan(0)
  })

  it('JioHotstar is never relevant', () => {
    const r = assessRelevance('JioHotstar new season', terms)
    expect(r.relevant).toBe(false)
    expect(['no_match', 'negative_term']).toContain(r.reason)
  })

  it('JioStar and Jio Financial Services report negative_term', () => {
    expect(assessRelevance('JioStar streaming deal', terms).reason).toBe('negative_term')
    expect(assessRelevance('Jio Financial Services Q2 results', terms).reason).toBe('negative_term')
  })

  it('surname only, no IPO term, is not relevant', () => {
    expect(assessRelevance('Ambani wedding photos', terms)).toMatchObject({
      relevant: false,
      reason: 'no_match',
    })
  })

  it('bare jio is not relevant', () => {
    expect(assessRelevance('jio', terms).relevant).toBe(false)
    expect(assessRelevance('जियो', terms).relevant).toBe(false)
  })

  it('a URL or @handle alone cannot make a post relevant', () => {
    expect(assessRelevance('look at this https://x.com/jio_ipo', terms).relevant).toBe(false)
    expect(assessRelevance('thanks @jio_ipo', terms).relevant).toBe(false)
  })
})
