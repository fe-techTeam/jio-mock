// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Lang, Sentiment } from '@jio/core'
import { computeAccuracy, type AccuracyRow } from './compute'

const row = (
  i: number,
  o: Partial<AccuracyRow> & { g?: Sentiment; m?: Sentiment } = {},
): AccuracyRow => ({
  postId: `p${i}`,
  lang: o.lang ?? 'en',
  gold: { sentiment: o.g ?? 'positive', topicSlug: 't1', entities: ['jio'] },
  model:
    o.model === null
      ? null
      : (o.model ?? {
          sentiment: o.m ?? o.g ?? 'positive',
          topicSlug: 't1',
          entities: ['jio'],
          promptVersion: 'v1',
        }),
  sarcastic: o.sarcastic ?? false,
})
const rows = (n: number, make: (i: number) => AccuracyRow = (i) => row(i)) =>
  Array.from({ length: n }, (_, i) => make(i))
const OPTS = { target: 200 }

describe('computeAccuracy', () => {
  it('199 labels: measured false and every figure null', () => {
    const r = computeAccuracy(rows(199), OPTS)
    expect(r).toMatchObject({
      labelled: 199,
      target: 200,
      measured: false,
      overall: null,
      byLang: { en: null, hinglish: null, hi: null, gu: null, other: null },
      confusion: null,
      sarcasm: null,
    })
  })

  it('200 labels with 150 sentiment matches gives 0.75', () => {
    const r = computeAccuracy(
      rows(200, (i) => row(i, { g: 'positive', m: i < 150 ? 'positive' : 'negative' })),
      OPTS,
    )
    expect(r.measured).toBe(true)
    expect(r.overall).toEqual({ sentiment: 0.75, topic: 1, entitiesExact: 1 })
  })

  it('rounds to 3 decimals', () => {
    const r = computeAccuracy(
      rows(200, (i) => row(i, { m: i < 1 ? 'negative' : 'positive' })),
      OPTS,
    )
    expect(r.overall!.sentiment).toBe(0.995)
    const r2 = computeAccuracy(
      rows(200, (i) => row(i, { m: i < 3 ? 'negative' : 'positive' })),
      {
        target: 200,
      },
    )
    expect(r2.overall!.sentiment).toBe(0.985)
  })

  it('confusion row sums equal the per-gold-class counts', () => {
    const golds: Sentiment[] = ['negative', 'neutral', 'positive']
    const r = computeAccuracy(
      rows(200, (i) => row(i, { g: golds[i % 3]!, m: golds[(i + (i % 5 === 0 ? 1 : 0)) % 3]! })),
      OPTS,
    )
    const c = r.confusion!
    const goldCounts = [0, 0, 0]
    for (let i = 0; i < 200; i++) goldCounts[i % 3]!++
    expect(c.map((rw) => rw.reduce((a, b) => a + b, 0))).toEqual(goldCounts)
    expect(c.flat().reduce((a, b) => a + b, 0)).toBe(200)
  })

  it('hinglish-only mistakes lower only the hinglish figure', () => {
    const langs: Lang[] = ['en', 'hinglish', 'hi', 'gu']
    const r = computeAccuracy(
      rows(200, (i) => {
        const lang = langs[i % 4]!
        return row(i, { lang, m: lang === 'hinglish' && i % 8 === 1 ? 'negative' : 'positive' })
      }),
      OPTS,
    )
    expect(r.byLang.en).toEqual({ n: 50, sentiment: 1, topic: 1 })
    expect(r.byLang.hi!.sentiment).toBe(1)
    expect(r.byLang.gu!.sentiment).toBe(1)
    expect(r.byLang.hinglish).toEqual({ n: 50, sentiment: 0.5, topic: 1 })
    expect(r.byLang.other).toBeNull()
  })

  it('sarcasm subset uses only sarcastic rows', () => {
    const r = computeAccuracy(
      rows(200, (i) => row(i, { sarcastic: i < 4, m: i < 2 ? 'negative' : 'positive' })),
      OPTS,
    )
    expect(r.sarcasm).toEqual({ n: 4, sentiment: 0.5 })
    const none = computeAccuracy(rows(200), OPTS)
    expect(none.sarcasm).toBeNull()
  })

  it('rows without a model row are unscored and leave the denominators', () => {
    const r = computeAccuracy(
      rows(200, (i) => row(i, i < 20 ? { model: null } : { m: i < 30 ? 'negative' : 'positive' })),
      OPTS,
    )
    expect(r.unscored).toBe(20)
    expect(r.overall!.sentiment).toBe(0.944)
    expect(r.confusion!.flat().reduce((a, b) => a + b, 0)).toBe(180)
  })

  it('a promptVersion filter makes older-version rows unscored', () => {
    const r = computeAccuracy(
      rows(200, (i) =>
        row(i, {
          model: {
            sentiment: 'positive',
            topicSlug: 't1',
            entities: ['jio'],
            promptVersion: i < 50 ? 'v1' : 'v2',
          },
        }),
      ),
      { target: 200, promptVersion: 'v2' },
    )
    expect(r.unscored).toBe(50)
  })

  it('entity exactness ignores order and flags differences', () => {
    const r = computeAccuracy(
      rows(200, (i) => ({
        ...row(i),
        gold: { sentiment: 'positive', topicSlug: 't1', entities: ['jio', 'isha'] },
        model: {
          sentiment: 'positive',
          topicSlug: i < 100 ? 't1' : 't2',
          entities: i < 50 ? ['isha', 'jio'] : ['jio'],
          promptVersion: 'v1',
        },
      })),
      OPTS,
    )
    expect(r.overall).toEqual({ sentiment: 1, topic: 0.5, entitiesExact: 0.25 })
  })
})
