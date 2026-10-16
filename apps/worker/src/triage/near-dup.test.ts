import { describe, expect, it } from 'vitest'
import { assignNearDup, NEAR_DUP_COSINE, NEIGHBOR_WINDOW_HOURS, type DbNeighbor } from './near-dup'

const t0 = new Date('2026-10-20T05:00:00Z')
const at = (min: number) => new Date(t0.getTime() + min * 60_000)

/** A unit 2-d vector at `deg` degrees; cos(a-b) is the similarity. */
const dir = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
const degFor = (sim: number) => (Math.acos(sim) * 180) / Math.PI

describe('assignNearDup', () => {
  it('exports the thresholds', () => {
    expect(NEAR_DUP_COSINE).toBe(0.95)
    expect(NEIGHBOR_WINDOW_HOURS).toBe(48)
  })

  it('chain A~B~C in one batch forms one cluster named after the first item', () => {
    const step = degFor(0.97)
    const items = [
      { id: 'c', publishedAt: at(20), vector: dir(2 * step) },
      { id: 'a', publishedAt: at(0), vector: dir(0) },
      { id: 'b', publishedAt: at(10), vector: dir(step) },
    ]
    const { clusterOf, neighborUpdates } = assignNearDup(items, new Map())
    expect(clusterOf.get('a')).toBe('nd_a')
    expect(clusterOf.get('b')).toBe('nd_a')
    expect(clusterOf.get('c')).toBe('nd_a')
    expect(neighborUpdates).toEqual([])
  })

  it('an isolated item stays unclustered', () => {
    const items = [
      { id: 'a', publishedAt: at(0), vector: dir(0) },
      { id: 'b', publishedAt: at(1), vector: dir(90) },
    ]
    const { clusterOf } = assignNearDup(items, new Map())
    expect(clusterOf.has('a')).toBe(false)
    expect(clusterOf.has('b')).toBe(false)
  })

  it('adopts the cluster of an existing DB neighbor', () => {
    const neighbors = new Map<string, DbNeighbor[]>([
      ['x', [{ id: 'old', clusterId: 'nd_old0', similarity: 0.99 }]],
    ])
    const { clusterOf, neighborUpdates } = assignNearDup(
      [{ id: 'x', publishedAt: at(0), vector: dir(0) }],
      neighbors,
    )
    expect(clusterOf.get('x')).toBe('nd_old0')
    expect(neighborUpdates).toEqual([])
  })

  it('creates a cluster for an unclustered DB neighbor and updates it once', () => {
    const neighbors = new Map<string, DbNeighbor[]>([
      ['x', [{ id: 'old', clusterId: null, similarity: 0.96 }]],
      ['y', [{ id: 'old', clusterId: null, similarity: 0.97 }]],
    ])
    const { clusterOf, neighborUpdates } = assignNearDup(
      [
        { id: 'x', publishedAt: at(0), vector: dir(0) },
        { id: 'y', publishedAt: at(5), vector: dir(90) },
      ],
      neighbors,
    )
    expect(clusterOf.get('x')).toBe('nd_old')
    expect(clusterOf.get('y')).toBe('nd_old')
    expect(neighborUpdates).toEqual([{ id: 'old', clusterId: 'nd_old' }])
  })

  it('joins the most similar neighbor and never merges two clusters', () => {
    const neighbors = new Map<string, DbNeighbor[]>([
      [
        'x',
        [
          { id: 'p', clusterId: 'nd_p', similarity: 0.96 },
          { id: 'q', clusterId: 'nd_q', similarity: 0.99 },
        ],
      ],
    ])
    const { clusterOf, neighborUpdates } = assignNearDup(
      [{ id: 'x', publishedAt: at(0), vector: dir(0) }],
      neighbors,
    )
    expect(clusterOf.get('x')).toBe('nd_q')
    expect(neighborUpdates).toEqual([])
  })

  it('similarity 0.9499 does not join', () => {
    const neighbors = new Map<string, DbNeighbor[]>([
      ['x', [{ id: 'old', clusterId: 'nd_old', similarity: 0.9499 }]],
    ])
    const items = [
      { id: 'a', publishedAt: at(0), vector: dir(0) },
      { id: 'b', publishedAt: at(1), vector: dir(degFor(0.9499)) },
      { id: 'x', publishedAt: at(2), vector: dir(180) },
    ]
    const { clusterOf } = assignNearDup(items, neighbors)
    expect(clusterOf.size).toBe(0)
  })

  it('in-batch items more than 48h apart do not join', () => {
    const items = [
      { id: 'a', publishedAt: at(0), vector: dir(0) },
      { id: 'b', publishedAt: at(48 * 60 + 1), vector: dir(0) },
    ]
    expect(assignNearDup(items, new Map()).clusterOf.size).toBe(0)
  })
})
