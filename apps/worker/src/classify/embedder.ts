// Embedding interface for triage (relevance, near-duplicates) and Emerging clustering.
import { HashingEmbedder } from './embed-stub'
import { VoyageEmbedder } from './voyage'

export const EMBED_DIMS = 1024

export interface Embedder {
  readonly model: string
  readonly dims: 1024
  /** One vector per text, in input order. */
  embed(texts: string[]): Promise<{ vectors: number[][]; costUsd: number }>
}

/**
 * Voyage (`voyage-multilingual-2`) when `apiKey` is non-empty, else the deterministic hashing
 * stub. The caller passes `process.env.VOYAGE_API_KEY`; this factory never reads env itself.
 *
 * Vectors from the two models are not comparable: switching models leaves old rows in
 * posts.embedding from the other model (see SUMMARY-03-01).
 */
export function createEmbedder(opts: { apiKey?: string; fetchImpl?: typeof fetch }): Embedder {
  const apiKey = opts.apiKey?.trim()
  if (apiKey) return new VoyageEmbedder({ apiKey, fetchImpl: opts.fetchImpl })
  return new HashingEmbedder()
}
