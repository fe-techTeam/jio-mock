// Deterministic hashed bag-of-words embedder used when no VOYAGE_API_KEY is set. It is good at
// one thing, exact and near-exact copies (near-duplicate detection), and carries no semantics.
import { normalizeForHash } from '../triage/hash'
import type { Embedder } from './embedder'

const DIMS = 1024
const TOKEN_RE = /[\p{L}\p{N}]+/gu
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
/** Offset basis for the second (sign) hash. */
const SIGN_SEED = 0x9747b28c
const BIGRAM_WEIGHT = 0.5
const encoder = new TextEncoder()

/** FNV-1a 32-bit over the UTF-8 bytes of `s`, as an unsigned integer. */
export function fnv1a(s: string, seed = FNV_OFFSET): number {
  let h = seed >>> 0
  for (const byte of encoder.encode(s)) {
    h ^= byte
    h = Math.imul(h, FNV_PRIME)
  }
  return h >>> 0
}

function addFeature(v: Float64Array, feature: string, weight: number): void {
  const index = fnv1a(feature) % DIMS
  const sign = fnv1a(feature, SIGN_SEED) & 0x80000000 ? -1 : 1
  v[index] = (v[index] ?? 0) + sign * weight
}

/**
 * Unigrams (weight 1) and adjacent bigrams (weight 0.5) of normalizeForHash(text), hashed into
 * 1024 signed buckets and L2-normalized. Text with no tokens (only a URL, emoji or empty) gives an
 * all-zero vector: callers must not store it (triage writes NULL) because cosine is undefined.
 */
export function hashEmbed(text: string): number[] {
  const tokens = normalizeForHash(text).match(TOKEN_RE) ?? []
  const v = new Float64Array(DIMS)
  for (let i = 0; i < tokens.length; i++) {
    addFeature(v, tokens[i]!, 1)
    if (i > 0) addFeature(v, `${tokens[i - 1]} ${tokens[i]}`, BIGRAM_WEIGHT)
  }
  let sq = 0
  for (const x of v) sq += x * x
  const n = Math.sqrt(sq)
  return Array.from(v, (x) => (n > 0 ? x / n : 0))
}

export class HashingEmbedder implements Embedder {
  readonly model = 'hash-stub-v1'
  readonly dims = DIMS as 1024

  async embed(texts: string[]): Promise<{ vectors: number[][]; costUsd: number }> {
    return { vectors: texts.map(hashEmbed), costUsd: 0 }
  }
}
