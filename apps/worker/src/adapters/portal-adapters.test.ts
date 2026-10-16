import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_CONFIG,
  type FetchContext,
  type MarketSeries,
  type SourceAdapter,
  type SourceKey,
} from '@jio/core'
import { RateLimitedError, SourceParseError } from '../breaker'
import { createFakeFetch } from './_fixture'
import chittorgarh, { spec as chittorgarhSpec } from './portal-chittorgarh'
import investorgain, { spec as investorgainSpec } from './portal-investorgain'
import ipowatch, { spec as ipowatchSpec } from './portal-ipowatch'
import { createPortalAdapter, type PortalSpec } from './portal-shared'

const page = (name: string) =>
  readFileSync(new URL(`./__fixtures__/portal/${name}`, import.meta.url), 'utf8')
const fixtureHtml = (file: string) =>
  readFileSync(new URL(`../../fixtures/${file}`, import.meta.url), 'utf8')

const html = (body: string) => new Response(body, { status: 200 })

const SERIES: MarketSeries[] = ['gmp_inr', 'sub_qib_x', 'sub_nii_x', 'sub_retail_x', 'sub_total_x']

interface Case {
  key: SourceKey
  adapter: SourceAdapter
  spec: PortalSpec
  expected: Record<MarketSeries, number>
  observedAt: string
}

const CASES: Case[] = [
  {
    key: 'portal_chittorgarh',
    adapter: chittorgarh,
    spec: chittorgarhSpec,
    expected: {
      gmp_inr: 85,
      sub_qib_x: 6.82,
      sub_nii_x: 9.15,
      sub_retail_x: 2.41,
      sub_total_x: 5.37,
    },
    observedAt: '2026-10-16T08:35:00.000Z',
  },
  {
    key: 'portal_investorgain',
    adapter: investorgain,
    spec: investorgainSpec,
    expected: { gmp_inr: 82, sub_qib_x: 6.9, sub_nii_x: 9.4, sub_retail_x: 2.5, sub_total_x: 5.4 },
    observedAt: '2026-10-16T08:50:00.000Z',
  },
  {
    key: 'portal_ipowatch',
    adapter: ipowatch,
    spec: ipowatchSpec,
    expected: { gmp_inr: 80, sub_qib_x: 6.7, sub_nii_x: 9, sub_retail_x: 2.4, sub_total_x: 5.3 },
    observedAt: '2026-10-16T08:40:00.000Z',
  },
]

const ctx = (key: SourceKey, mode: 'fixture' | 'live'): FetchContext => ({
  since: new Date('2026-10-09T00:00:00Z'),
  source: DEFAULT_CONFIG.sources[key],
  terms: DEFAULT_CONFIG.terms,
  mode,
  signal: new AbortController().signal,
  creds: {},
})

const byUrl = (spec: PortalSpec, body: string) =>
  createFakeFetch([
    [new RegExp(`^${spec.gmpUrl}$`), () => html(body)],
    [new RegExp(`^${spec.subscriptionUrl}$`), () => html(body)],
  ])

const asMap = (points: { series: MarketSeries; value: number }[]) =>
  Object.fromEntries(points.map((p) => [p.series, p.value]))

let fetchSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchSpy = vi.fn(createFakeFetch([]))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(CASES)('$key adapter', ({ key, adapter, spec, expected, observedAt }) => {
  it('is a keyless media-lane adapter', () => {
    expect(adapter).toMatchObject({ key, lane: 'media', requiredCreds: [] })
  })

  it('fixture mode yields all 5 series for Jio Platforms and 2+ news posts, with no network', async () => {
    const res = await adapter.fetch(ctx(key, 'fixture'))
    expect(res.marketPoints).toHaveLength(5)
    expect(res.marketPoints!.map((p) => p.series).sort()).toEqual([...SERIES].sort())
    expect(asMap(res.marketPoints!)).toEqual(expected)
    for (const p of res.marketPoints!) {
      expect(p.sourceKey).toBe(key)
      expect(p.observedAt.toISOString()).toBe(observedAt)
      expect(p.sourceUrl).not.toContain('#fixture')
    }
    expect(res.posts.length).toBeGreaterThanOrEqual(2)
    expect(res.posts.every((p) => p.sourceKey === key && p.author?.kind === 'media_outlet')).toBe(
      true,
    )
    expect(res.costUsd).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('live mode parses the same values and records the page each value came from', async () => {
    const live = createPortalAdapter(spec, { fetch: byUrl(spec, fixtureHtml(spec.fixtureFile)) })
    const res = await live.fetch(ctx(key, 'live'))
    expect(asMap(res.marketPoints!)).toEqual(expected)
    for (const p of res.marketPoints!) {
      expect(p.sourceUrl).toBe(p.series === 'gmp_inr' ? spec.gmpUrl : spec.subscriptionUrl)
    }
  })

  it('live mode sends the research user agent and the abort signal', async () => {
    const seen: RequestInit[] = []
    const f = createFakeFetch([
      [
        /.*/,
        (_url, init) => {
          seen.push(init!)
          return html(fixtureHtml(spec.fixtureFile))
        },
      ],
    ])
    const c = ctx(key, 'live')
    await createPortalAdapter(spec, { fetch: f }).fetch(c)
    expect(seen).toHaveLength(2)
    expect((seen[0]!.headers as Record<string, string>)['user-agent']).toBe(
      'jio-ipo-analysis/0.1 (+internal research)',
    )
    expect(seen[0]!.signal).toBe(c.signal)
  })

  it('a page without an issuer row gives no market points and does not throw', async () => {
    const live = createPortalAdapter(spec, { fetch: byUrl(spec, page('no-issuer.html')) })
    const res = await live.fetch(ctx(key, 'live'))
    expect(res.marketPoints).toEqual([])
  })

  it.each(['drifted.html', 'js-rendered.html'])(
    '%s rejects with SourceParseError',
    async (file) => {
      const live = createPortalAdapter(spec, { fetch: byUrl(spec, page(file)) })
      await expect(live.fetch(ctx(key, 'live'))).rejects.toBeInstanceOf(SourceParseError)
    },
  )

  it('a 503 rejects with an HTTP error', async () => {
    const f = createFakeFetch([[/.*/, () => new Response('down', { status: 503 })]])
    await expect(createPortalAdapter(spec, { fetch: f }).fetch(ctx(key, 'live'))).rejects.toThrow(
      `HTTP 503 ${spec.gmpUrl}`,
    )
  })

  it('a 429 rejects with RateLimitedError 30 minutes ahead', async () => {
    const now = new Date('2026-10-16T09:00:00Z')
    const f = createFakeFetch([[/.*/, () => new Response('slow down', { status: 429 })]])
    const err = await createPortalAdapter(spec, { fetch: f, now: () => now })
      .fetch(ctx(key, 'live'))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.toISOString()).toBe('2026-10-16T09:30:00.000Z')
  })

  it('never reads the Jio Financial decoy values', async () => {
    const res = await adapter.fetch(ctx(key, 'fixture'))
    const decoys = [999, 777, 650, 55.1, 40.5, 51.2, 33.33, 27.7, 30.1]
    expect(res.marketPoints!.some((p) => decoys.includes(p.value))).toBe(false)
  })
})

describe('fixture pages', () => {
  it('each portal fixture has 4 IPO rows and a Jio Financial decoy', () => {
    for (const c of CASES) {
      const text = fixtureHtml(c.spec.fixtureFile)
      expect(text).toMatch(/Jio Financial Services/)
      expect(text).toMatch(/Jio Platforms/)
    }
  })
})
