import { describe, expect, it, vi } from 'vitest'
import { createEmbedder, EMBED_DIMS } from './embedder'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

describe('createEmbedder', () => {
  it('EMBED_DIMS is 1024', () => {
    expect(EMBED_DIMS).toBe(1024)
  })

  it('returns the hashing stub without an API key', async () => {
    for (const e of [createEmbedder({}), createEmbedder({ apiKey: '' })]) {
      expect(e.model).toBe('hash-stub-v1')
      expect(e.dims).toBe(EMBED_DIMS)
      const out = await e.embed(['Jio IPO GMP'])
      expect(out.vectors[0]).toHaveLength(EMBED_DIMS)
      expect(out.costUsd).toBe(0)
    }
  })

  it('returns the Voyage embedder with an API key', () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const e = createEmbedder({ apiKey: 'k', fetchImpl })
    expect(e.model).toBe('voyage-multilingual-2')
    expect(e.dims).toBe(EMBED_DIMS)
  })

  it('treats a whitespace-only key as missing', () => {
    expect(createEmbedder({ apiKey: '   ' }).model).toBe('hash-stub-v1')
  })
})
