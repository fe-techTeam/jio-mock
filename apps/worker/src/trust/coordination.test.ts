import { describe, expect, it } from 'vitest'
import type { Lane } from '@jio/core'
import { TRUST_DEFAULTS } from './config'
import {
  findCoordinatedPosts,
  isBurst,
  median,
  top5Share,
  type CoordinationPost,
} from './coordination'

const cfg = TRUST_DEFAULTS.coordination
const T0 = new Date('2026-10-16T04:00:00Z').getTime()
const at = (min: number) => new Date(T0 + min * 60_000)

let seq = 0
function post(
  authorId: string | null,
  min: number,
  opts: { clusterId?: string; lane?: Lane } = {},
): CoordinationPost {
  seq++
  return {
    id: `p${seq}`,
    clusterId: opts.clusterId ?? 'nd_a',
    authorId,
    lane: opts.lane ?? 'social',
    publishedAt: at(min),
  }
}

describe('findCoordinatedPosts', () => {
  it('flags every post when 5 distinct authors post within 59 minutes', () => {
    const ps = [post('a1', 0), post('a2', 10), post('a3', 20), post('a4', 40), post('a5', 59)]
    expect(findCoordinatedPosts(ps, cfg)).toEqual(new Set(ps.map((p) => p.id)))
  })

  it('does not flag 5 authors spread over 61 minutes', () => {
    const ps = [post('a1', 0), post('a2', 15), post('a3', 30), post('a4', 45), post('a5', 61)]
    expect(findCoordinatedPosts(ps, cfg).size).toBe(0)
  })

  it('does not flag 4 authors posting 10 times', () => {
    const ps = Array.from({ length: 10 }, (_, i) => post(`a${(i % 4) + 1}`, i * 3))
    expect(findCoordinatedPosts(ps, cfg).size).toBe(0)
  })

  it('does not flag 5 media-lane outlets (wire-copy syndication)', () => {
    const ps = [1, 2, 3, 4, 5].map((i) => post(`outlet${i}`, i, { lane: 'media' }))
    expect(findCoordinatedPosts(ps, cfg).size).toBe(0)
  })

  it('media posts never count toward the social threshold and are never flagged', () => {
    const social = [1, 2, 3, 4].map((i) => post(`a${i}`, i))
    const media = post('outlet', 5, { lane: 'media' })
    expect(findCoordinatedPosts([...social, media], cfg).size).toBe(0)
    const fifth = post('a5', 6)
    const flagged = findCoordinatedPosts([...social, media, fifth], cfg)
    expect(flagged.has(media.id)).toBe(false)
    expect(flagged.size).toBe(5)
  })

  it('ignores null authors when counting', () => {
    const ps = [
      post('a1', 0),
      post('a2', 1),
      post('a3', 2),
      post('a4', 3),
      post(null, 4),
      post(null, 5),
    ]
    expect(findCoordinatedPosts(ps, cfg).size).toBe(0)
  })

  it('flags null-author posts that sit inside a qualifying window', () => {
    const anon = post(null, 2)
    const ps = [post('a1', 0), anon, post('a2', 3), post('a3', 4), post('a4', 5), post('a5', 6)]
    expect(findCoordinatedPosts(ps, cfg).has(anon.id)).toBe(true)
  })

  it('counts repeat posts from the same author once', () => {
    const ps = [
      post('a1', 0),
      post('a1', 1),
      post('a1', 2),
      post('a2', 3),
      post('a3', 4),
      post('a4', 5),
    ]
    expect(findCoordinatedPosts(ps, cfg).size).toBe(0)
  })

  it('evaluates each cluster on its own and flags only the window', () => {
    const early = post('z9', -120)
    const a = [post('a1', 0), post('a2', 5), post('a3', 10), post('a4', 15), post('a5', 20)]
    const b = [1, 2, 3, 4].map((i) => post(`b${i}`, i, { clusterId: 'nd_b' }))
    const flagged = findCoordinatedPosts([early, ...b, ...a.reverse()], cfg)
    expect(flagged).toEqual(new Set(a.map((p) => p.id)))
  })

  it('returns an empty set for no posts', () => {
    expect(findCoordinatedPosts([], cfg).size).toBe(0)
  })
})

describe('median', () => {
  it('is 0 for [0,0,0,8] and for an empty list', () => {
    expect(median([0, 0, 0, 8])).toBe(0)
    expect(median([])).toBe(0)
  })
  it('averages the middle two of an even list and picks the middle of an odd one', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
  })
  it('is 3 for 96 values of 3', () => {
    expect(median(Array(96).fill(3))).toBe(3)
  })
})

describe('isBurst', () => {
  it('needs the item floor when the trailing median is zero', () => {
    expect(isBurst(9, [0, 0, 0, 8], cfg)).toBe(false)
    expect(isBurst(12, [0, 0, 0, 8], cfg)).toBe(true)
  })
  it('must be strictly above multiplier x median', () => {
    const trailing = Array(96).fill(3)
    expect(isBurst(12, trailing, cfg)).toBe(false)
    expect(isBurst(13, trailing, cfg)).toBe(true)
  })
})

describe('top5Share', () => {
  it('is the 5 largest counts over the total, to 2 dp', () => {
    expect(top5Share([10, 5, 5, 5, 5, 1, 1], 32, cfg)).toBe(0.94)
  })
  it('is null below top5MinItems', () => {
    expect(top5Share([10, 5, 5, 5, 4], 29, cfg)).toBeNull()
  })
  it('handles fewer than 5 authors', () => {
    expect(top5Share([10, 5], 40, cfg)).toBe(0.38)
  })
})
