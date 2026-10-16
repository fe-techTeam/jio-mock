import { describe, expect, it, vi } from 'vitest'
import { EmbedError, VoyageEmbedder } from './voyage'

vi.stubGlobal('fetch', () => {
  throw new Error('network access is not allowed in tests')
})

type Call = {
  url: string
  init: RequestInit
  body: { input: string[]; model: string; input_type: string }
}

function vec(seed: number, dims = 1024): number[] {
  return Array.from({ length: dims }, (_, i) => (i === 0 ? seed : 0))
}

function okResponse(
  input: string[],
  opts: { dims?: number; reverse?: boolean; tokens?: number } = {},
) {
  const data = input.map((t, i) => ({
    object: 'embedding',
    index: i,
    embedding: vec(Number(t.split('-')[1] ?? i), opts.dims),
  }))
  if (opts.reverse) data.reverse()
  return new Response(
    JSON.stringify({
      object: 'list',
      data,
      model: 'voyage-multilingual-2',
      usage: { total_tokens: opts.tokens ?? 10 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function fakeFetch(handler: (call: Call, n: number) => Response) {
  const calls: Call[] = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body)) }
    calls.push(call)
    return handler(call, calls.length)
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

const noSleep = async () => {}

describe('VoyageEmbedder', () => {
  it('posts the documented request', async () => {
    const f = fakeFetch((c) => okResponse(c.body.input))
    const e = new VoyageEmbedder({ apiKey: 'secret-key', fetchImpl: f.impl, sleep: noSleep })
    expect(e.model).toBe('voyage-multilingual-2')
    await e.embed(['t-1', 't-2'])
    expect(f.calls).toHaveLength(1)
    const c = f.calls[0]!
    expect(c.url).toBe('https://api.voyageai.com/v1/embeddings')
    expect(c.init.method).toBe('POST')
    const headers = new Headers(c.init.headers)
    expect(headers.get('authorization')).toBe('Bearer secret-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(c.body).toEqual({
      input: ['t-1', 't-2'],
      model: 'voyage-multilingual-2',
      input_type: 'document',
    })
  })

  it('returns no vectors and makes no call for an empty list', async () => {
    const f = fakeFetch((c) => okResponse(c.body.input))
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep: noSleep })
    expect(await e.embed([])).toEqual({ vectors: [], costUsd: 0 })
    expect(f.calls).toHaveLength(0)
  })

  it('truncates inputs to 8,000 chars', async () => {
    const f = fakeFetch((c) => okResponse(c.body.input))
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep: noSleep })
    await e.embed(['x'.repeat(9000)])
    expect(f.calls[0]!.body.input[0]).toHaveLength(8000)
  })

  it('chunks 130 texts into 64, 64, 2 and preserves order', async () => {
    const f = fakeFetch((c) => okResponse(c.body.input, { reverse: true, tokens: 1000 }))
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep: noSleep })
    const texts = Array.from({ length: 130 }, (_, i) => `t-${i}`)
    const out = await e.embed(texts)
    expect(f.calls.map((c) => c.body.input.length)).toEqual([64, 64, 2])
    expect(out.vectors).toHaveLength(130)
    out.vectors.forEach((v, i) => expect(v[0]).toBe(i))
    // 3 calls x 1000 tokens at $0.12 per million
    expect(out.costUsd).toBeCloseTo((3000 / 1e6) * 0.12, 12)
  })

  it('retries a 429 once and then succeeds, backing off 500 ms', async () => {
    const f = fakeFetch((c, n) =>
      n === 1 ? new Response('slow down', { status: 429 }) : okResponse(c.body.input),
    )
    const sleep = vi.fn(async () => {})
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep })
    const out = await e.embed(['t-7'])
    expect(f.calls).toHaveLength(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(500)
    expect(out.vectors[0]![0]).toBe(7)
  })

  it('gives up after 3 retries on 5xx with exponential backoff', async () => {
    const f = fakeFetch(() => new Response('boom', { status: 503 }))
    const sleep = vi.fn(async () => {})
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep })
    const err = await e.embed(['a']).catch((x: unknown) => x)
    expect(err).toBeInstanceOf(EmbedError)
    expect((err as EmbedError).status).toBe(503)
    expect(f.calls).toHaveLength(4)
    expect(sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([500, 1000, 2000])
  })

  it('throws EmbedError with status and body on a 400, without retrying', async () => {
    const f = fakeFetch(() => new Response('{"detail":"bad input"}', { status: 400 }))
    const e = new VoyageEmbedder({ apiKey: 'secret-key', fetchImpl: f.impl, sleep: noSleep })
    const err = await e.embed(['a']).catch((x: unknown) => x)
    expect(err).toBeInstanceOf(EmbedError)
    expect((err as EmbedError).status).toBe(400)
    expect((err as EmbedError).body).toContain('bad input')
    expect(String((err as Error).message)).not.toContain('secret-key')
    expect(f.calls).toHaveLength(1)
  })

  it('throws when a vector is not 1024 long', async () => {
    const f = fakeFetch((c) => okResponse(c.body.input, { dims: 512 }))
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep: noSleep })
    await expect(e.embed(['a'])).rejects.toBeInstanceOf(EmbedError)
  })

  it('throws when the response is missing an index', async () => {
    const f = fakeFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ index: 0, embedding: vec(0) }], usage: { total_tokens: 1 } }),
          {
            status: 200,
          },
        ),
    )
    const e = new VoyageEmbedder({ apiKey: 'k', fetchImpl: f.impl, sleep: noSleep })
    await expect(e.embed(['a', 'b'])).rejects.toBeInstanceOf(EmbedError)
  })
})
