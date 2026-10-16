// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchJson, getBrief, getEvidence, getTimeline, queryKeys } from './api'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

describe('fetchJson', () => {
  it('requests same-origin with no-store and drops empty params', async () => {
    fetchMock.mockResolvedValue(ok({ a: 1 }))
    const res = await fetchJson<{ a: number }>('/api/x', {
      entity: 'isha',
      topic: undefined,
      cursor: null,
      sort: '',
      limit: 10,
    })
    expect(res).toEqual({ a: 1 })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/x?entity=isha&limit=10')
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
  })

  it('omits the query string when there are no params', async () => {
    fetchMock.mockResolvedValue(ok({}))
    await fetchJson('/api/x')
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/x')
  })

  it('throws ApiError with the status and the body error', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad_request', issues: [1] }), { status: 400 }),
    )
    const err = await fetchJson('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, message: 'bad_request', issues: [1] })
  })

  it('throws ApiError for a non-JSON error body', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 502 }))
    const err = await fetchJson('/api/x').catch((e: unknown) => e)
    expect(err).toMatchObject({ status: 502, message: 'http_502' })
  })
})

describe('typed endpoints', () => {
  it('getBrief, getTimeline and getEvidence build the right URLs', async () => {
    fetchMock.mockImplementation(async () => ok({}))
    await getBrief({ entity: 'all', lane: 'media' })
    await getTimeline('valuation-price-band', { entity: 'jio', lane: 'all' })
    await getEvidence({ topic: 'emerging', sentiment: 'negative', cursor: 'abc', limit: 10 })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/brief?entity=all&lane=media',
      '/api/topics/valuation-price-band/timeline?entity=jio&lane=all',
      '/api/evidence?topic=emerging&sentiment=negative&cursor=abc&limit=10',
    ])
  })

  it('queryKeys are stable arrays', () => {
    expect(queryKeys.brief({ entity: 'isha', lane: 'all' })).toEqual(['brief', 'isha', 'all'])
    expect(queryKeys.timeline('a', { entity: 'all', lane: 'social' })).toEqual([
      'timeline',
      'a',
      'all',
      'social',
    ])
    expect(queryKeys.evidence({ topic: 'a' })).toEqual(['evidence', { topic: 'a' }])
  })
})

describe('browser safety', () => {
  it('imports only types from @jio/core and nothing server-side', () => {
    const src = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8')
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+'/.test(l))
    for (const line of imports) {
      expect(line).not.toMatch(/@jio\/db|['"](\.\/|@\/lib\/)(db|auth|session)['"]|postgres/)
      if (line.includes('@jio/core')) expect(line).toMatch(/^\s*import type\b|^\s*\}\s*from/)
    }
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+'@jio\/core'/)
    expect(src).not.toMatch(/require\(/)
  })
})
