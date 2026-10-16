import { describe, expect, it, vi } from 'vitest'
import { EMBED_DIMS } from './embedder'
import { HashingEmbedder } from './embed-stub'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)
const norm = (a: number[]) => Math.sqrt(dot(a, a))

describe('HashingEmbedder', () => {
  const e = new HashingEmbedder()

  it('identifies itself', () => {
    expect(e.model).toBe('hash-stub-v1')
    expect(e.dims).toBe(EMBED_DIMS)
  })

  it('returns one unit-length 1024-dim vector per text, at zero cost', async () => {
    const { vectors, costUsd } = await e.embed(['Jio IPO GMP kitna hai', 'Reliance Jio price band'])
    expect(costUsd).toBe(0)
    expect(vectors).toHaveLength(2)
    for (const v of vectors) {
      expect(v).toHaveLength(1024)
      expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-9)
    }
  })

  it('is deterministic across calls and instances', async () => {
    const t = 'Jio IPO allotment kab aayega bhai'
    const a = (await e.embed([t])).vectors[0]
    const b = (await new HashingEmbedder().embed([t])).vectors[0]
    expect(a).toEqual(b)
  })

  it('a tweet and its copy with a different URL score cosine >= 0.95', async () => {
    const { vectors } = await e.embed([
      'Jio IPO GMP at 85 today, listing gains look likely https://t.co/aaa111',
      'RT @someone: Jio IPO GMP at 85 today, listing gains look likely https://t.co/zzz999',
    ])
    expect(dot(vectors[0]!, vectors[1]!)).toBeGreaterThanOrEqual(0.95)
  })

  it('two unrelated IPO sentences score < 0.95', async () => {
    const { vectors } = await e.embed([
      'Jio IPO GMP at 85 today, listing gains look likely',
      'Retail quota for the Reliance Jio offer is too small, I will skip the subscription',
    ])
    expect(dot(vectors[0]!, vectors[1]!)).toBeLessThan(0.95)
  })

  it('Devanagari and Gujarati text produce non-zero vectors', async () => {
    const { vectors } = await e.embed(['जियो आईपीओ का जीएमपी', 'જિયો આઈપીઓ ક્યારે'])
    for (const v of vectors) expect(Math.abs(norm(v) - 1)).toBeLessThan(1e-9)
    expect(dot(vectors[0]!, vectors[1]!)).toBeLessThan(0.95)
  })

  it('text with no tokens gives an all-zero vector (callers must not store it)', async () => {
    const { vectors } = await e.embed(['https://t.co/x @someone 🚀', ''])
    for (const v of vectors) {
      expect(v).toHaveLength(1024)
      expect(v.every((x) => x === 0)).toBe(true)
    }
  })
})
