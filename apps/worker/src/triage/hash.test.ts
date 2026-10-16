import { describe, expect, it } from 'vitest'
import { contentHash, normalizeForHash } from './hash'

const tweet = 'Jio IPO GMP kitna chal raha hai bhai? #JioIPO'

describe('normalizeForHash', () => {
  it('lowercases, strips URLs, mentions, zero-width chars and collapses whitespace', () => {
    expect(
      normalizeForHash('  Ｊio\u200B IPO   @trader_1 https://t.co/AbC  www.x.com/y #JioIPO '),
    ).toBe('jio ipo #jioipo')
  })
  it('strips a leading RT prefix', () => {
    expect(normalizeForHash('RT @someone: ' + tweet)).toBe(normalizeForHash(tweet))
    expect(normalizeForHash('rt ' + tweet)).toBe(normalizeForHash(tweet))
  })
  it('keeps an e-mail-like token intact apart from case', () => {
    expect(normalizeForHash('mail ipo@jio.com')).toBe('mail ipo@jio.com')
  })
})

describe('contentHash', () => {
  it('is 64 hex chars', () => {
    expect(contentHash(tweet)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('ignores a different t.co link', () => {
    expect(contentHash(tweet + ' https://t.co/aaa111')).toBe(
      contentHash(tweet + ' https://t.co/bbb222'),
    )
  })
  it('ignores an RT @x: prefix', () => {
    expect(contentHash('RT @x: ' + tweet)).toBe(contentHash(tweet))
  })
  it('differs for different wording', () => {
    expect(contentHash(tweet)).not.toBe(contentHash('Jio IPO GMP kitna hai yaar? #JioIPO'))
  })
})
