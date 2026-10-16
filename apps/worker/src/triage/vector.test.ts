import { describe, expect, it } from 'vitest'
import { centroid, cosine, l2normalize, toPgVector } from './vector'

describe('vector helpers', () => {
  it('cosine of parallel, orthogonal and opposite vectors', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 12)
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0, 12)
    expect(cosine([1, 1], [-1, -1])).toBeCloseTo(-1, 12)
  })
  it('cosine with a zero vector or a length mismatch is 0', () => {
    expect(cosine([0, 0], [1, 0])).toBe(0)
    expect(cosine([1, 0, 0], [1, 0])).toBe(0)
  })
  it('l2normalize gives unit length and leaves a zero vector alone', () => {
    const v = l2normalize([3, 4])
    expect(v[0]).toBeCloseTo(0.6, 12)
    expect(v[1]).toBeCloseTo(0.8, 12)
    expect(l2normalize([0, 0])).toEqual([0, 0])
  })
  it('centroid is the normalized mean', () => {
    const c = centroid([
      [1, 0],
      [0, 1],
    ])
    expect(c[0]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(c[1]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(centroid([])).toEqual([])
  })
  it('toPgVector renders a pgvector literal', () => {
    expect(toPgVector([0.1, -2, 3])).toBe('[0.1,-2,3]')
  })
  it('toPgVector rejects non-finite values', () => {
    expect(() => toPgVector([1, Number.NaN])).toThrow()
  })
})
