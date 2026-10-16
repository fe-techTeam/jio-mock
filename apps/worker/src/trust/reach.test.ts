import { describe, expect, it } from 'vitest'
import { TRUST_DEFAULTS } from './config'
import {
  computeReachScore,
  mainMetric,
  p95LogBySource,
  percentile,
  shouldFullRescore,
  type ReachRow,
} from './reach'

const cfg = TRUST_DEFAULTS.reach

describe('mainMetric', () => {
  it('uses followers for X and LinkedIn, falling back to the author row', () => {
    expect(mainMetric('x_api', { followers: 120, likes: 4 })).toBe(120)
    expect(mainMetric('x_apify', {}, 300)).toBe(300)
    expect(mainMetric('apify_linkedin', { likes: 5 }, 42)).toBe(42)
    expect(mainMetric('x_api', { followers: 7 }, 9000)).toBe(7)
    expect(mainMetric('x_api', { likes: 3 })).toBeUndefined()
  })

  it('uses views for YouTube, upvotes for Reddit and likes for Instagram', () => {
    expect(mainMetric('youtube', { views: 1000, likes: 10 })).toBe(1000)
    expect(mainMetric('reddit', { upvotes: 12, comments: 3 })).toBe(12)
    expect(mainMetric('apify_instagram', { likes: 50, views: 900 })).toBe(50)
    expect(mainMetric('youtube', { likes: 10 })).toBeUndefined()
  })

  it('returns undefined for every other source', () => {
    expect(mainMetric('news_rss', { followers: 10 })).toBeUndefined()
    expect(mainMetric('web_search', {}, 10)).toBeUndefined()
    expect(mainMetric('portal_chittorgarh', {})).toBeUndefined()
  })

  it('ignores negative or non-finite values', () => {
    expect(mainMetric('reddit', { upvotes: -4 })).toBeUndefined()
    expect(mainMetric('youtube', { views: Number.NaN })).toBeUndefined()
  })
})

describe('percentile', () => {
  it('interpolates linearly: [1..100] at 0.95 is 95.05', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(percentile(xs, 0.95)).toBeCloseTo(95.05, 10)
  })

  it('returns 0 for an empty array and the value for one item', () => {
    expect(percentile([], 0.95)).toBe(0)
    expect(percentile([7], 0.95)).toBe(7)
  })

  it('does not depend on input order', () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3)
  })
})

describe('computeReachScore', () => {
  const social = (sourceKey: ReachRow['sourceKey'], reachRaw: Record<string, number>) => ({
    lane: 'social' as const,
    sourceKey,
    reachRaw,
  })

  it('scores a 10k-follower X post about 0.8 when p95Log is 5', () => {
    expect(computeReachScore(social('x_api', { followers: 10_000 }), 5, cfg)).toBeCloseTo(0.8, 3)
  })

  it('gives 0 followers the floor', () => {
    expect(computeReachScore(social('x_api', { followers: 0 }), 5, cfg)).toBe(0.05)
  })

  it('gives a missing metric the unknown score', () => {
    expect(computeReachScore(social('x_api', {}), 5, cfg)).toBe(0.25)
    expect(computeReachScore(social('news_rss', {}), 5, cfg)).toBe(0.25)
  })

  it('gives a media-lane post the outlet weight whatever its metric', () => {
    const raws: Record<string, number>[] = [{}, { followers: 0 }, { followers: 10_000_000 }]
    for (const raw of raws) {
      expect(computeReachScore({ lane: 'media', sourceKey: 'x_api', reachRaw: raw }, 5, cfg)).toBe(
        0.6,
      )
    }
  })

  it('never exceeds 1', () => {
    expect(computeReachScore(social('x_api', { followers: 1e12 }), 5, cfg)).toBe(1)
  })

  it('treats p95Log <= 0 as 1', () => {
    expect(computeReachScore(social('reddit', { upvotes: 9 }), 0, cfg)).toBe(1)
    expect(computeReachScore(social('reddit', { upvotes: 0 }), -2, cfg)).toBe(0.05)
  })

  it('uses authorFollowers when reach_raw has none', () => {
    const s = computeReachScore({ ...social('x_api', {}), authorFollowers: 10_000 }, 5, cfg)
    expect(s).toBeCloseTo(0.8, 3)
  })
})

describe('p95LogBySource', () => {
  const rows = (n: number, sourceKey: ReachRow['sourceKey'], lane: 'social' | 'media' = 'social') =>
    Array.from({ length: n }, (_, i) => ({
      sourceKey,
      lane,
      reachRaw: { upvotes: 10 ** ((i % 4) + 1) - 1 },
    }))

  it('uses the default p95 with fewer than 20 samples', () => {
    const out = p95LogBySource(rows(19, 'reddit'), cfg)
    expect(out.reddit).toBe(3)
    expect(out.x_api).toBe(5)
  })

  it('uses the computed percentile with 20 or more social samples', () => {
    // log10(1+m) cycles 1,2,3,4: p95 of 20 values = 4
    const out = p95LogBySource(rows(20, 'reddit'), cfg)
    expect(out.reddit).toBeCloseTo(4, 10)
  })

  it('ignores media rows and rows without a metric', () => {
    const media = rows(30, 'reddit', 'media')
    const noMetric = Array.from({ length: 30 }, () => ({
      sourceKey: 'reddit' as const,
      lane: 'social' as const,
      reachRaw: {},
    }))
    expect(p95LogBySource([...media, ...noMetric], cfg).reddit).toBe(3)
  })

  it('falls back to 4 for a source with no default', () => {
    expect(p95LogBySource([], cfg).news_rss).toBe(4)
  })
})

describe('shouldFullRescore', () => {
  const now = new Date('2026-10-16T04:00:00Z')
  it('is true without a previous full pass', () => {
    expect(shouldFullRescore(null, now, cfg)).toBe(true)
  })
  it('is true once fullRescoreEveryMin has passed, false before', () => {
    expect(shouldFullRescore(new Date(now.getTime() - 59 * 60_000), now, cfg)).toBe(false)
    expect(shouldFullRescore(new Date(now.getTime() - 60 * 60_000), now, cfg)).toBe(true)
  })
})
