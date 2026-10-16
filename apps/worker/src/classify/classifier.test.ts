import { describe, expect, it } from 'vitest'
import { SEED_TOPICS } from '@jio/core'
import { UNCLASSIFIED_SLUG, classifiableTopics, normalizeResult } from './classifier'

const SLUGS = new Set(['gmp-grey-market', 'valuation-price-band'])

const good = {
  topic: 'gmp-grey-market',
  sentiment: 'positive',
  entities: ['jio'],
  confidence: 'high',
  gloss_en: 'What is the Jio GMP today?',
}

const LOW = {
  topicSlug: UNCLASSIFIED_SLUG,
  sentiment: 'neutral',
  entities: [],
  confidence: 'low',
  glossEn: null,
}

describe('normalizeResult', () => {
  it('maps a valid raw item onto a ClassifyResult', () => {
    expect(normalizeResult(good, 'post-1', SLUGS)).toEqual({
      postId: 'post-1',
      topicSlug: 'gmp-grey-market',
      sentiment: 'positive',
      entities: ['jio'],
      confidence: 'high',
      glossEn: 'What is the Jio GMP today?',
    })
  })

  it.each([
    ['null', null],
    ['a string', 'gmp'],
    ['a missing sentiment', { ...good, sentiment: undefined }],
    ['an unknown sentiment', { ...good, sentiment: 'bullish' }],
    ['an unknown confidence', { ...good, confidence: 'medium' }],
    ['a non-array entities', { ...good, entities: 'jio' }],
    ['a non-string topic', { ...good, topic: 3 }],
  ])('returns the low/unclassified result for %s', (_label, raw) => {
    expect(normalizeResult(raw, 'post-2', SLUGS)).toEqual({ postId: 'post-2', ...LOW })
  })

  it('sends an unknown topic slug to unclassified/low and keeps sentiment and entities', () => {
    const r = normalizeResult({ ...good, topic: 'made-up' }, 'p', SLUGS)
    expect(r).toMatchObject({
      topicSlug: UNCLASSIFIED_SLUG,
      confidence: 'low',
      sentiment: 'positive',
      entities: ['jio'],
    })
  })

  it('sends low confidence to unclassified even when the slug is valid', () => {
    const r = normalizeResult({ ...good, confidence: 'low' }, 'p', SLUGS)
    expect(r).toMatchObject({
      topicSlug: UNCLASSIFIED_SLUG,
      confidence: 'low',
      sentiment: 'positive',
    })
  })

  it('treats an explicit unclassified topic as low confidence', () => {
    const r = normalizeResult({ ...good, topic: 'unclassified' }, 'p', SLUGS)
    expect(r).toMatchObject({ topicSlug: UNCLASSIFIED_SLUG, confidence: 'low' })
  })

  it('dedupes entities and drops anything that is not an EntityKey', () => {
    const r = normalizeResult(
      { ...good, entities: ['isha', 'jio', 'isha', 'reliance', 'Mukesh', 'mukesh'] },
      'p',
      SLUGS,
    )
    expect(r.entities).toEqual(['isha', 'jio', 'mukesh'])
  })

  it('trims the gloss, caps it at 200 chars, and turns empty into null', () => {
    expect(normalizeResult({ ...good, gloss_en: '   ' }, 'p', SLUGS).glossEn).toBeNull()
    expect(normalizeResult({ ...good, gloss_en: '' }, 'p', SLUGS).glossEn).toBeNull()
    expect(normalizeResult({ ...good, gloss_en: undefined }, 'p', SLUGS).glossEn).toBeNull()
    expect(normalizeResult({ ...good, gloss_en: '  hi  ' }, 'p', SLUGS).glossEn).toBe('hi')
    const long = normalizeResult({ ...good, gloss_en: 'x'.repeat(500) }, 'p', SLUGS).glossEn
    expect(long).toHaveLength(200)
  })
})

describe('classifiableTopics', () => {
  it('drops the emerging and unclassified buckets and keeps topic order', () => {
    const slugs = classifiableTopics(SEED_TOPICS).map((t) => t.slug)
    expect(slugs).toHaveLength(10)
    expect(slugs).not.toContain('emerging')
    expect(slugs).not.toContain('unclassified')
    expect(slugs[0]).toBe(SEED_TOPICS[0]!.slug)
  })
})
