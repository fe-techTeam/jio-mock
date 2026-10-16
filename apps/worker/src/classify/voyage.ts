// Voyage AI embeddings over plain fetch (no SDK). The only module here that calls the network.
import type { Embedder } from './embedder'

const DIMS = 1024
export const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings'
export const VOYAGE_MODEL = 'voyage-multilingual-2'
/** USD per million tokens. */
export const VOYAGE_USD_PER_MTOK = 0.12
const CHUNK = 64
const MAX_CHARS = 8_000
const MAX_RETRIES = 3
const BACKOFF_MS = 500
const BODY_SNIPPET = 500

export class EmbedError extends Error {
  readonly status: number
  readonly body: string
  constructor(message: string, status: number, body: string) {
    super(message)
    this.name = 'EmbedError'
    this.status = status
    this.body = body
  }
}

type VoyageResponse = {
  data?: { index?: unknown; embedding?: unknown }[]
  usage?: { total_tokens?: unknown }
}

export type VoyageOptions = {
  apiKey: string
  fetchImpl?: typeof fetch
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Per-request timeout (default 30s). */
  timeoutMs?: number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export class VoyageEmbedder implements Embedder {
  readonly model = VOYAGE_MODEL
  readonly dims = DIMS as 1024
  readonly #apiKey: string
  readonly #fetch: typeof fetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #timeoutMs: number

  constructor(opts: VoyageOptions) {
    this.#apiKey = opts.apiKey
    // Resolved per call when not injected, so a test's stubbed global is honoured.
    this.#fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.#sleep = opts.sleep ?? defaultSleep
    this.#timeoutMs = opts.timeoutMs ?? 30_000
  }

  async embed(texts: string[]): Promise<{ vectors: number[][]; costUsd: number }> {
    const vectors: number[][] = []
    let tokens = 0
    for (let i = 0; i < texts.length; i += CHUNK) {
      const chunk = texts.slice(i, i + CHUNK).map((t) => String(t ?? '').slice(0, MAX_CHARS))
      const out = await this.#embedChunk(chunk)
      vectors.push(...out.vectors)
      tokens += out.tokens
    }
    return { vectors, costUsd: (tokens / 1e6) * VOYAGE_USD_PER_MTOK }
  }

  async #embedChunk(input: string[]): Promise<{ vectors: number[][]; tokens: number }> {
    const body = JSON.stringify({ input, model: VOYAGE_MODEL, input_type: 'document' })
    for (let attempt = 0; ; attempt++) {
      const res = await this.#fetch(VOYAGE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#apiKey}`, 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
      if (res.ok) return parse(await res.json(), input.length)
      const text = (await res.text().catch(() => '')).slice(0, BODY_SNIPPET)
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= MAX_RETRIES) {
        throw new EmbedError(`Voyage embeddings failed: HTTP ${res.status}`, res.status, text)
      }
      await this.#sleep(BACKOFF_MS * 2 ** attempt)
    }
  }
}

function parse(json: unknown, expected: number): { vectors: number[][]; tokens: number } {
  const r = (json ?? {}) as VoyageResponse
  const data = Array.isArray(r.data) ? r.data : []
  const vectors: (number[] | undefined)[] = new Array(expected)
  for (const d of data) {
    const idx = d.index
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= expected) {
      throw new EmbedError('Voyage response has an invalid index', 200, String(idx))
    }
    const emb = d.embedding
    if (!Array.isArray(emb) || emb.length !== DIMS || !emb.every((x) => typeof x === 'number')) {
      const len = Array.isArray(emb) ? emb.length : -1
      throw new EmbedError(`Voyage returned a vector of length ${len}, expected ${DIMS}`, 200, '')
    }
    vectors[idx] = emb as number[]
  }
  for (let i = 0; i < expected; i++) {
    if (!vectors[i]) throw new EmbedError(`Voyage response is missing index ${i}`, 200, '')
  }
  const total = Number(r.usage?.total_tokens)
  return { vectors: vectors as number[][], tokens: Number.isFinite(total) ? total : 0 }
}
