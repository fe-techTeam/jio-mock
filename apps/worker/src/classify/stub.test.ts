import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, SEED_TOPICS } from '@jio/core'
import type { TopicDef } from '@jio/core'
import { StubClassifier } from './stub'

const stub = () => new StubClassifier({ terms: structuredClone(DEFAULT_CONFIG.terms) })

async function one(text: string, lang: 'en' | 'hinglish' | 'hi' | 'gu' | 'other' = 'en') {
  const [r] = await stub().classify([{ postId: 'x', text, lang }], SEED_TOPICS)
  return r!
}

describe('StubClassifier', () => {
  it('identifies itself', () => {
    const s = stub()
    expect(s.model).toBe('stub-v1')
    expect(s.promptVersion).toBe('stub-v1')
  })

  it('labels a Hinglish GMP post as the GMP topic, positive, about jio', async () => {
    const r = await one('Jio IPO GMP kitna? kostak strong', 'hinglish')
    expect(r).toMatchObject({
      postId: 'x',
      topicSlug: 'gmp-grey-market',
      sentiment: 'positive',
      entities: ['jio'],
      confidence: 'high',
    })
    expect(r.glossEn).toMatch(/^\[stub\] /)
  })

  it('picks the topic by score and finds person entities', async () => {
    const r = await one('Isha Ambani succession talk, promoter control worries')
    expect(r.topicSlug).toBe('ambani-family-leadership')
    expect(r.entities).toContain('isha')
    expect(r.confidence).toBe('high')
    expect(r.glossEn).toBeNull()
  })

  it('sends text with no topic signal to unclassified/low', async () => {
    const r = await one('random text')
    expect(r).toMatchObject({ topicSlug: 'unclassified', confidence: 'low', sentiment: 'neutral' })
    expect(r.entities).toEqual([])
  })

  it('scores negative lexicon hits', async () => {
    const r = await one('Jio IPO valuation is overvalued and expensive, avoid')
    expect(r.topicSlug).toBe('valuation-price-band')
    expect(r.sentiment).toBe('negative')
  })

  it('handles Hindi input and glosses it', async () => {
    const text = 'जियो आईपीओ का प्राइस बैंड बहुत महंगा है'
    const r = await one(text, 'hi')
    expect(r.topicSlug).toBe('valuation-price-band')
    expect(r.sentiment).toBe('negative')
    expect(r.glossEn).toBe('[stub] ' + text)
  })

  it('caps the gloss source at 100 chars', async () => {
    const r = await one('अलॉटमेंट '.repeat(30), 'hi')
    expect(r.glossEn).toBe('[stub] ' + 'अलॉटमेंट '.repeat(30).slice(0, 100).trim())
  })

  it('does not treat "ai" inside other words as the digital topic', async () => {
    const r = await one('Jio network complaint, customer care said wait again')
    expect(r.topicSlug).toBe('customer-experience')
  })

  it('uses hints keyed by topic name so renamed slugs still work', async () => {
    const topics: TopicDef[] = [
      {
        slug: 'x-telecom',
        name: 'Telecom tariffs',
        kind: 'seed',
        description: '',
        examplePhrases: [],
      },
      { slug: 'x-gmp', name: 'Grey market', kind: 'seed', description: '', examplePhrases: [] },
    ]
    const [r] = await stub().classify(
      [{ postId: 'p', text: 'kostak and sauda rates', lang: 'en' }],
      topics,
    )
    expect(r!.topicSlug).toBe('x-gmp')
  })

  it('breaks ties by topic order', async () => {
    const topics: TopicDef[] = [
      { slug: 'first', name: 'Listing day', kind: 'seed', description: '', examplePhrases: [] },
      { slug: 'second', name: 'Allotment', kind: 'seed', description: '', examplePhrases: [] },
    ]
    const [r] = await stub().classify(
      [{ postId: 'p', text: 'listing and allotment', lang: 'en' }],
      topics,
    )
    expect(r!.topicSlug).toBe('first')
  })

  it('finds every person alias and the jio company aliases', async () => {
    const r = await one('Mukesh Ambani and Akash Ambani at Reliance Jio AGM')
    expect(r.entities).toEqual(['mukesh', 'akash', 'jio'])
  })

  it('does not tag jio for the bare word "jio"', async () => {
    const r = await one('jio aur jeene do, listing gain')
    expect(r.entities).toEqual([])
  })

  it('is deterministic and returns one result per input in input order', async () => {
    const items = [
      { postId: 'a', text: 'Allotment mila kya?', lang: 'hinglish' as const },
      { postId: 'b', text: '', lang: 'en' as const },
      { postId: 'c', text: 'Tariff hike before the IPO to pump ARPU', lang: 'en' as const },
      { postId: 'd', text: 'જિયો નેટવર્ક બંધ છે, ખરાબ', lang: 'gu' as const },
    ]
    const first = await stub().classify(items, SEED_TOPICS)
    const second = await stub().classify(structuredClone(items), structuredClone(SEED_TOPICS))
    expect(second).toEqual(first)
    expect(first.map((r) => r.postId)).toEqual(['a', 'b', 'c', 'd'])
    expect(first[0]!.topicSlug).toBe('allotment-retail-access')
    expect(first[1]).toMatchObject({ topicSlug: 'unclassified', confidence: 'low' })
    expect(first[2]!.topicSlug).toBe('telecom-business')
    expect(first[3]!.sentiment).toBe('negative')
  })

  it('never assigns the emerging or unclassified buckets as topics', async () => {
    const r = await one('emerging unclassified')
    expect(r.topicSlug).toBe('unclassified')
    expect(r.confidence).toBe('low')
  })
})
