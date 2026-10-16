// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearMemo, memo } from './cache'
import { decodeCursor, encodeCursor } from './cursor'
import { BriefParams, EvidenceParams, ParamError, TimelineParams, parseParams } from './params'
import { authorLabel, toEvidenceAuthor } from './privacy'
import { isActive, lowConfPct, rankScore, rankTopics, splitShown, trendOf } from './ranking'
import { floor15, floorIstHour, istHours, range7d, windowRanges } from './window'

const iso = (d: Date) => d.toISOString()
const qs = (s: string) => new URLSearchParams(s)
const MIN = 60_000
const HOUR = 60 * MIN

describe('window', () => {
  const now = new Date('2026-10-16T08:07:12Z')

  it('floor15 floors to the quarter hour', () => {
    expect(iso(floor15(now))).toBe('2026-10-16T08:00:00.000Z')
    expect(iso(floor15(new Date('2026-10-16T08:15:00Z')))).toBe('2026-10-16T08:15:00.000Z')
  })

  it('windowRanges covers 96 buckets ending after the current bucket', () => {
    const { cur, prev } = windowRanges(now)
    expect(iso(cur.to)).toBe('2026-10-16T08:15:00.000Z')
    expect(iso(cur.from)).toBe('2026-10-15T08:15:00.000Z')
    expect(iso(prev.to)).toBe(iso(cur.from))
    expect(iso(prev.from)).toBe('2026-10-14T08:15:00.000Z')
    expect((cur.to.getTime() - cur.from.getTime()) / (15 * MIN)).toBe(96)
  })

  it('a bucket at cur.from is in cur and one 15 min earlier is in prev', () => {
    const { cur, prev } = windowRanges(now)
    const inRange = (b: Date, r: { from: Date; to: Date }) => b >= r.from && b < r.to
    expect(inRange(cur.from, cur)).toBe(true)
    expect(inRange(cur.from, prev)).toBe(false)
    const earlier = new Date(cur.from.getTime() - 15 * MIN)
    expect(inRange(earlier, cur)).toBe(false)
    expect(inRange(earlier, prev)).toBe(true)
  })

  it('range7d covers 672 buckets', () => {
    const r = range7d(now)
    expect(iso(r.to)).toBe('2026-10-16T08:15:00.000Z')
    expect((r.to.getTime() - r.from.getTime()) / (15 * MIN)).toBe(672)
  })

  it('floorIstHour starts IST hours at :30 UTC', () => {
    expect(iso(floorIstHour(new Date('2026-10-16T03:45:00Z')))).toBe('2026-10-16T03:30:00.000Z')
    expect(iso(floorIstHour(new Date('2026-10-16T03:29:59Z')))).toBe('2026-10-16T02:30:00.000Z')
  })

  it('istHours returns n ascending hour starts ending at the current IST hour', () => {
    const hours = istHours(now, 168)
    expect(hours).toHaveLength(168)
    expect(iso(hours[167]!)).toBe('2026-10-16T07:30:00.000Z')
    expect(hours[1]!.getTime() - hours[0]!.getTime()).toBe(HOUR)
    expect(iso(hours[0]!)).toBe(iso(new Date(hours[167]!.getTime() - 167 * HOUR)))
  })

  it('15-minute buckets align identically in UTC and IST', () => {
    const istOffset = 330 * MIN
    for (const t of ['2026-10-16T03:44:59Z', '2026-10-16T21:31:00Z', '2026-10-17T00:00:00Z']) {
      const d = new Date(t)
      const viaIst = new Date(
        Math.floor((d.getTime() + istOffset) / (15 * MIN)) * 15 * MIN - istOffset,
      )
      expect(iso(floor15(d))).toBe(iso(viaIst))
    }
  })
})

describe('ranking', () => {
  it('trendOf classifies against the prior 24h', () => {
    expect(trendOf(5, 0)).toEqual({ trend: 'new', deltaPct: null })
    expect(trendOf(0, 0)).toEqual({ trend: 'flat', deltaPct: null })
    expect(trendOf(11, 10)).toEqual({ trend: 'up', deltaPct: 10 })
    expect(trendOf(9, 10)).toEqual({ trend: 'down', deltaPct: -10 })
    expect(trendOf(105, 100)).toEqual({ trend: 'flat', deltaPct: 5 })
    expect(trendOf(1, 3)).toEqual({ trend: 'down', deltaPct: -66.7 })
  })

  it('rankScore is sqrt(items x authors) times clamped velocity', () => {
    expect(rankScore({ items: 30, prev: 30, uniqueAuthors: 30 })).toBeCloseTo(30, 6)
    expect(rankScore({ items: 100, prev: 0, uniqueAuthors: 1 })).toBeCloseTo(30, 6) // velocity 3
    expect(rankScore({ items: 1, prev: 99, uniqueAuthors: 1 })).toBeCloseTo(0.5, 6) // velocity 0.5
  })

  it('40 items from 2 authors ranks below 30 items from 30 authors', () => {
    const rows = [
      { name: 'Few voices', items: 40, prev: 40, uniqueAuthors: 2 },
      { name: 'Many voices', items: 30, prev: 30, uniqueAuthors: 30 },
    ].map((r) => ({ ...r, score: rankScore(r) }))
    expect(rankTopics(rows).map((r) => r.name)).toEqual(['Many voices', 'Few voices'])
  })

  it('ties break by items desc then name asc', () => {
    const rows = [
      { name: 'b', items: 10, score: 5 },
      { name: 'a', items: 10, score: 5 },
      { name: 'c', items: 12, score: 5 },
      { name: 'd', items: 1, score: 9 },
    ]
    expect(rankTopics(rows).map((r) => r.name)).toEqual(['d', 'c', 'a', 'b'])
  })

  it('isActive and splitShown thresholds', () => {
    expect(isActive(9)).toBe(false)
    expect(isActive(10)).toBe(true)
    expect(isActive(4, 5)).toBe(false)
    expect(splitShown(29)).toBe(false)
    expect(splitShown(30)).toBe(true)
    expect(splitShown(12, 12)).toBe(true)
  })

  it('lowConfPct rounds to 1 dp and is 0 with no items', () => {
    expect(lowConfPct(1, 3)).toBe(33.3)
    expect(lowConfPct(0, 0)).toBe(0)
    expect(lowConfPct(3, 0)).toBe(0)
  })
})

describe('privacy', () => {
  it('labels hidden authors by platform', () => {
    expect(authorLabel('x_api')).toBe('X user')
    expect(authorLabel('x_apify')).toBe('X user')
    expect(authorLabel('reddit')).toBe('Reddit user')
    expect(authorLabel('youtube')).toBe('YouTube user')
    expect(authorLabel('apify_instagram')).toBe('Instagram user')
    expect(authorLabel('apify_linkedin')).toBe('LinkedIn user')
    expect(authorLabel('news_rss')).toBe('News source')
    expect(authorLabel('web_search')).toBe('Web result')
    expect(authorLabel('portal_chittorgarh')).toBe('IPO portal')
    expect(authorLabel('portal_investorgain')).toBe('IPO portal')
    expect(authorLabel('portal_ipowatch')).toBe('IPO portal')
  })

  it("never exposes an 'other' author's handle or name", () => {
    const res = toEvidenceAuthor(
      { kind: 'other', handle: 'secret_handle', displayName: 'Secret Person' },
      'reddit',
    )
    expect(res).toEqual({ visible: false, label: 'Reddit user' })
    const json = JSON.stringify(res)
    expect(json).not.toContain('secret_handle')
    expect(json).not.toContain('Secret Person')
  })

  it('shows media outlets and public figures', () => {
    expect(
      toEvidenceAuthor({ kind: 'media_outlet', handle: 'livemint', displayName: 'Mint' }, 'x_api'),
    ).toEqual({ visible: true, kind: 'media_outlet', handle: 'livemint', displayName: 'Mint' })
    expect(
      toEvidenceAuthor({ kind: 'public_figure', handle: null, displayName: 'A Person' }, 'youtube'),
    ).toEqual({ visible: true, kind: 'public_figure', handle: null, displayName: 'A Person' })
  })

  it('handles a missing author', () => {
    expect(toEvidenceAuthor(null, 'news_rss')).toEqual({ visible: false, label: 'News source' })
  })
})

describe('cursor', () => {
  const id = '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c'

  it('round-trips reach and newest cursors', () => {
    const reach = { s: 'reach' as const, r: 0.25, t: '2026-10-16T07:00:00.123456Z', id }
    expect(decodeCursor(encodeCursor(reach), 'reach')).toEqual(reach)
    const newest = { s: 'newest' as const, t: '2026-10-16T07:00:00.000Z', id }
    expect(decodeCursor(encodeCursor(newest), 'newest')).toEqual(newest)
    expect(encodeCursor(newest)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects garbage and sort mismatches', () => {
    expect(() => decodeCursor('not a cursor!!', 'reach')).toThrow(ParamError)
    expect(() => decodeCursor(Buffer.from('{"s":"reach"}').toString('base64url'), 'reach')).toThrow(
      ParamError,
    )
    const newest = encodeCursor({ s: 'newest', t: '2026-10-16T07:00:00.000Z', id })
    expect(() => decodeCursor(newest, 'reach')).toThrow(ParamError)
    const badId = encodeCursor({ s: 'newest', t: '2026-10-16T07:00:00.000Z', id: "1' or 1=1" })
    expect(() => decodeCursor(badId, 'newest')).toThrow(ParamError)
  })
})

describe('params', () => {
  it('defaults brief filters and treats empty strings as missing', () => {
    expect(parseParams(BriefParams, qs(''))).toEqual({ entity: 'all', lane: 'all' })
    expect(parseParams(BriefParams, qs('entity=&lane='))).toEqual({ entity: 'all', lane: 'all' })
    expect(parseParams(TimelineParams, qs('entity=isha&lane=media'))).toEqual({
      entity: 'isha',
      lane: 'media',
    })
  })

  it('rejects unknown entity and lane values', () => {
    expect(() => parseParams(BriefParams, qs('entity=anant'))).toThrow(ParamError)
    expect(() => parseParams(BriefParams, qs('lane=x'))).toThrow(ParamError)
    try {
      parseParams(BriefParams, qs('entity=anant'))
    } catch (e) {
      expect((e as ParamError).issues.length).toBeGreaterThan(0)
    }
  })

  it('applies evidence defaults', () => {
    expect(parseParams(EvidenceParams, qs(''))).toEqual({
      entity: 'all',
      lane: 'all',
      window: '24h',
      sort: 'reach',
      limit: 20,
    })
  })

  it('parses a full evidence query', () => {
    const p = parseParams(
      EvidenceParams,
      qs(
        'topic=valuation-price-band&sentiment=negative&entity=jio&lane=social&window=7d' +
          '&source=reddit&confidence=low&sort=newest&limit=50',
      ),
    )
    expect(p).toMatchObject({
      topic: 'valuation-price-band',
      sentiment: 'negative',
      entity: 'jio',
      lane: 'social',
      window: '7d',
      source: 'reddit',
      confidence: 'low',
      sort: 'newest',
      limit: 50,
    })
  })

  it.each([
    'window=30d',
    'topic=Bad Slug',
    'topic=' + 'a'.repeat(65),
    'sentiment=angry',
    'source=facebook',
    'confidence=high',
    'sort=random',
    'limit=0',
    'limit=51',
    'limit=2.5',
    'limit=abc',
    'from=2026-10-16T00:00:00Z',
    'to=2026-10-16T00:00:00Z',
    'from=2026-10-16T05:00:00Z&to=2026-10-16T04:00:00Z',
    'from=2026-10-01T00:00:00Z&to=2026-10-16T00:00:00Z',
    'from=yesterday&to=today',
    'cursor=garbage!!',
  ])('rejects %s', (q) => {
    expect(() => parseParams(EvidenceParams, qs(q))).toThrow(ParamError)
  })

  it('accepts from/to within 7 days as dates', () => {
    const p = parseParams(EvidenceParams, qs('from=2026-10-15T00:00:00Z&to=2026-10-16T00:00:00Z'))
    expect(p.from).toEqual(new Date('2026-10-15T00:00:00Z'))
    expect(p.to).toEqual(new Date('2026-10-16T00:00:00Z'))
  })

  it('accepts a cursor that matches the sort', () => {
    const c = encodeCursor({
      s: 'newest',
      t: '2026-10-16T07:00:00.000Z',
      id: '6f1c2b1e-8a43-4f5e-9a8e-0d5b8e1f2a3c',
    })
    expect(parseParams(EvidenceParams, qs(`sort=newest&cursor=${c}`)).cursor).toBe(c)
    expect(() => parseParams(EvidenceParams, qs(`sort=reach&cursor=${c}`))).toThrow(ParamError)
  })
})

describe('memo', () => {
  let t = 0
  const clock = () => t
  beforeEach(() => {
    t = 1_000_000
    clearMemo()
  })
  afterEach(() => clearMemo())

  it('runs fn once within the TTL and again after it', async () => {
    let calls = 0
    const fn = async () => ++calls
    expect(await memo('k', 15_000, fn, clock)).toBe(1)
    t += 14_999
    expect(await memo('k', 15_000, fn, clock)).toBe(1)
    t += 1
    expect(await memo('k', 15_000, fn, clock)).toBe(2)
    expect(calls).toBe(2)
  })

  it('shares one in-flight promise per key', async () => {
    let calls = 0
    let release!: (v: number) => void
    const fn = () => {
      calls++
      return new Promise<number>((r) => (release = r))
    }
    const a = memo('k', 15_000, fn, clock)
    const b = memo('k', 15_000, fn, clock)
    release(7)
    expect(await Promise.all([a, b])).toEqual([7, 7])
    expect(calls).toBe(1)
  })

  it('keys are independent', async () => {
    let calls = 0
    const fn = async () => ++calls
    await memo('a', 15_000, fn, clock)
    await memo('b', 15_000, fn, clock)
    expect(calls).toBe(2)
  })

  it('never caches a rejection', async () => {
    let calls = 0
    const fn = async () => {
      calls++
      if (calls === 1) throw new Error('db down')
      return 'ok'
    }
    await expect(memo('k', 15_000, fn, clock)).rejects.toThrow('db down')
    expect(await memo('k', 15_000, fn, clock)).toBe('ok')
    expect(calls).toBe(2)
  })

  it('turns a synchronous throw into a rejection', async () => {
    const fn = (): Promise<number> => {
      throw new Error('sync')
    }
    await expect(memo('k', 15_000, fn, clock)).rejects.toThrow('sync')
  })

  it('caps the store at 200 keys, evicting the oldest', async () => {
    let calls = 0
    const fn = async () => ++calls
    for (let i = 0; i < 201; i++) await memo(`k${i}`, 15_000, fn, clock)
    expect(calls).toBe(201)
    await memo('k200', 15_000, fn, clock) // newest still cached
    expect(calls).toBe(201)
    await memo('k0', 15_000, fn, clock) // oldest evicted
    expect(calls).toBe(202)
  })
})
