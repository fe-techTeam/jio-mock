import { describe, expect, it } from 'vitest'
import {
  clusterUnclassified,
  emergingSlug,
  isCandidate,
  topTokens,
  type ClusterItem,
} from './emerging'

const DIMS = 8
function unit(i: number, wobble = 0): number[] {
  const v = new Array<number>(DIMS).fill(0)
  v[i] = 1
  v[(i + 1) % DIMS] = wobble
  return v
}

const t0 = Date.parse('2026-10-16T00:00:00Z')
function item(id: string, vector: number[], authorId: string | null, minutes = 0): ClusterItem {
  return { id, authorId, vector, publishedAt: new Date(t0 + minutes * 60_000) }
}

describe('clusterUnclassified', () => {
  it('groups near vectors and separates far ones', () => {
    const items = [
      item('a1', unit(0), 'u1', 0),
      item('b1', unit(3), 'u2', 1),
      item('a2', unit(0, 0.1), 'u3', 2),
      item('a3', unit(0, 0.2), 'u4', 3),
      item('b2', unit(3, 0.1), 'u5', 4),
    ]
    const clusters = clusterUnclassified(items)
    const sets = clusters.map((c) => c.members.map((m) => m.id).sort())
    expect(sets).toEqual([
      ['a1', 'a2', 'a3'],
      ['b1', 'b2'],
    ])
  })

  it('visits items in publishedAt order regardless of input order', () => {
    const items = [item('late', unit(0, 0.1), 'u1', 10), item('early', unit(0), 'u2', 0)]
    const [c] = clusterUnclassified(items)
    expect(c!.members.map((m) => m.id)).toEqual(['early', 'late'])
  })

  it('respects the threshold', () => {
    const items = [item('a', unit(0), 'u1', 0), item('b', unit(0, 1), 'u2', 1)] // cosine ~0.71
    expect(clusterUnclassified(items, 0.8)).toHaveLength(2)
    expect(clusterUnclassified(items, 0.7)).toHaveLength(1)
  })
})

describe('isCandidate', () => {
  const cluster = (n: number, authors: (string | null)[]) => ({
    members: Array.from({ length: n }, (_, i) =>
      item(`p${i}`, unit(0), authors[i % authors.length]!, i),
    ),
    centroid: unit(0),
  })

  it('needs at least 5 posts and 3 distinct authors', () => {
    expect(isCandidate(cluster(5, ['u1', 'u2', 'u3']))).toBe(true)
    expect(isCandidate(cluster(4, ['u1', 'u2', 'u3', 'u4']))).toBe(false)
    expect(isCandidate(cluster(6, ['u1', 'u2']))).toBe(false)
  })

  it('counts each null author as distinct', () => {
    expect(isCandidate(cluster(5, ['u1', null, null]))).toBe(true)
  })
})

describe('emergingSlug', () => {
  it('is deterministic for the same members in any order and dated in IST', () => {
    const now = new Date('2026-10-16T20:00:00Z') // 01:30 IST on the 17th
    const a = emergingSlug(now, ['p2', 'p1', 'p3'])
    expect(a).toBe(emergingSlug(now, ['p3', 'p2', 'p1']))
    expect(a).toMatch(/^emerging-20261017-[0-9a-f]{6}$/)
    expect(emergingSlug(now, ['p1', 'p2'])).not.toBe(a)
  })
})

describe('topTokens', () => {
  it('ranks by document frequency, skips stopwords and the ever-present IPO words', () => {
    const texts = [
      'The Jio IPO lottery scam alert',
      'jio ipo LOTTERY scam is fake',
      'lottery scam again, the jio ipo',
    ]
    expect(topTokens(texts, 3)).toEqual(['lottery', 'scam', 'again'])
  })
})
