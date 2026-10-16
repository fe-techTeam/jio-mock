import { describe, expect, it } from 'vitest'
import { SEED_TOPICS } from './seed-topics'

const INDIC = /[\u0900-\u097F\u0A80-\u0AFF]/

describe('SEED_TOPICS', () => {
  it('has 12 topics with unique kebab slugs', () => {
    expect(SEED_TOPICS).toHaveLength(12)
    const slugs = SEED_TOPICS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(12)
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/)
  })

  it('uses the resolved taxonomy slugs in order', () => {
    expect(SEED_TOPICS.map((t) => t.slug)).toEqual([
      'valuation-price-band',
      'gmp-grey-market',
      'subscription-demand',
      'allotment-retail-access',
      'listing-expectations',
      'ambani-family-leadership',
      'governance-promoter-control',
      'telecom-business',
      'digital-ai-growth',
      'customer-experience',
      'emerging',
      'unclassified',
    ])
  })

  it('has exactly 10 seed topics plus emerging and unclassified buckets', () => {
    expect(SEED_TOPICS.filter((t) => t.kind === 'seed')).toHaveLength(10)
    expect(SEED_TOPICS.find((t) => t.slug === 'emerging')).toMatchObject({
      kind: 'emerging',
      name: 'Emerging',
    })
    expect(SEED_TOPICS.find((t) => t.slug === 'unclassified')).toMatchObject({
      kind: 'unclassified',
      name: 'Unclassified',
    })
  })

  it('names follow the design resolutions', () => {
    const names = Object.fromEntries(SEED_TOPICS.map((t) => [t.slug, t.name]))
    expect(names['valuation-price-band']).toBe('Valuation and price band')
    expect(names['gmp-grey-market']).toBe('GMP and grey market')
    expect(names['customer-experience']).toBe('Customer experience and service complaints')
  })

  it('mentions the RIL shareholder quota under allotment', () => {
    const t = SEED_TOPICS.find((x) => x.slug === 'allotment-retail-access')!
    expect(t.description).toMatch(/shareholder quota/i)
  })

  it('gives every topic a one-sentence description', () => {
    for (const t of SEED_TOPICS) {
      expect(t.description.length, t.slug).toBeGreaterThan(10)
      expect(t.description.trim().endsWith('.'), t.slug).toBe(true)
    }
  })

  it('gives each seed topic 3-5 example phrases, at least one in Hindi or Gujarati script', () => {
    for (const t of SEED_TOPICS.filter((x) => x.kind === 'seed')) {
      expect(t.examplePhrases.length, t.slug).toBeGreaterThanOrEqual(3)
      expect(t.examplePhrases.length, t.slug).toBeLessThanOrEqual(5)
      expect(
        t.examplePhrases.some((p) => INDIC.test(p)),
        t.slug,
      ).toBe(true)
    }
  })
})
