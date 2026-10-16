import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type FetchContext, type FetchResult } from '@jio/core'
import { RateLimitedError, SourceAuthError } from '../breaker'
import { createFakeFetch } from './_fixture'
import youtubeDefault, {
  BUDGET,
  YOUTUBE_NEWS_CHANNELS,
  allowance,
  buildYoutubeQuery,
  createYoutubeAdapter,
  ptDay,
} from './youtube'

const NOW = new Date('2026-10-16T12:00:00Z') // 05:00 PDT, 2026-10-16
const SINCE = new Date('2026-10-14T00:00:00Z')
const fx = (name: string) =>
  readFileSync(new URL(`./__fixtures__/youtube/${name}`, import.meta.url), 'utf8')
const reply = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } })

function ctx(over: Partial<FetchContext> = {}): FetchContext {
  return {
    since: SINCE,
    source: DEFAULT_CONFIG.sources.youtube,
    terms: DEFAULT_CONFIG.terms,
    mode: 'live',
    signal: new AbortController().signal,
    creds: { YOUTUBE_API_KEY: 'yt-key' },
    ...over,
  }
}

interface Handlers {
  search?: (url: URL) => Response
  videos?: (url: URL) => Response
  comments?: (url: URL) => Response
}

function server(h: Handlers = {}) {
  const calls: { kind: 'search' | 'videos' | 'comments'; url: URL; init?: RequestInit }[] = []
  const f = createFakeFetch([
    [
      /googleapis\.com\/youtube\/v3\/search\?/,
      (u, init) => {
        const url = new URL(u)
        calls.push({ kind: 'search', url, init })
        return h.search ? h.search(url) : reply(fx('search.json'))
      },
    ],
    [
      /googleapis\.com\/youtube\/v3\/videos\?/,
      (u, init) => {
        const url = new URL(u)
        calls.push({ kind: 'videos', url, init })
        return h.videos ? h.videos(url) : reply(fx('videos.json'))
      },
    ],
    [
      /googleapis\.com\/youtube\/v3\/commentThreads\?/,
      (u, init) => {
        const url = new URL(u)
        calls.push({ kind: 'comments', url, init })
        if (h.comments) return h.comments(url)
        return reply(
          fx(
            url.searchParams.get('videoId') === 'vid1'
              ? 'comments-vid1.json'
              : 'comments-vid2.json',
          ),
        )
      },
    ],
  ])
  return { calls, f }
}

const kinds = <T extends { kind: string }>(calls: T[], k: string) =>
  calls.filter((c) => c.kind === k)
const quotaOf = (r: FetchResult) =>
  (
    JSON.parse(r.nextCursor!) as {
      quota: { unitsUsedToday: number; day: string; resetsAt: string; limit: number }
    }
  ).quota

afterEach(() => vi.unstubAllGlobals())

describe('youtube adapter', () => {
  it('keeps the stub identity', () => {
    expect(youtubeDefault.key).toBe('youtube')
    expect(youtubeDefault.lane).toBe('social')
    expect(youtubeDefault.requiredCreds).toEqual(['YOUTUBE_API_KEY'])
  })

  it('searches with the documented params', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    const search = kinds(s.calls, 'search')
    expect(search).toHaveLength(1)
    const p = search[0]!.url.searchParams
    expect(p.get('part')).toBe('snippet')
    expect(p.get('type')).toBe('video')
    expect(p.get('order')).toBe('date')
    expect(p.get('maxResults')).toBe('50')
    expect(p.get('regionCode')).toBe('IN')
    expect(p.get('key')).toBe('yt-key')
    expect(p.get('publishedAfter')).toBe(SINCE.toISOString())
    expect(p.get('q')).toBe(buildYoutubeQuery(DEFAULT_CONFIG.terms))
    expect(search[0]!.init?.signal).toBeDefined()
  })

  it('clamps publishedAfter to the last 7 days', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    await createYoutubeAdapter({ now: () => NOW }).fetch(
      ctx({ since: new Date('2026-09-01T00:00:00Z') }),
    )
    expect(kinds(s.calls, 'search')[0]!.url.searchParams.get('publishedAfter')).toBe(
      '2026-10-09T12:00:00.000Z',
    )
  })

  it('calls videos.list once for new ids and commentThreads once per tracked video', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    const videos = kinds(s.calls, 'videos')
    expect(videos).toHaveLength(1)
    expect(videos[0]!.url.searchParams.get('part')).toBe('snippet,statistics')
    expect(videos[0]!.url.searchParams.get('id')).toBe('vid1,vid2')
    const comments = kinds(s.calls, 'comments')
    expect(comments.map((c) => c.url.searchParams.get('videoId'))).toEqual(['vid1', 'vid2'])
    const p = comments[0]!.url.searchParams
    expect(p.get('part')).toBe('snippet')
    expect(p.get('order')).toBe('time')
    expect(p.get('maxResults')).toBe('100')
    expect(p.get('textFormat')).toBe('plainText')
  })

  it('maps videos with channel kind', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    const v1 = res.posts.find((p) => p.externalId === 'video:vid1')!
    expect(v1.url).toBe('https://www.youtube.com/watch?v=vid1')
    expect(v1.text).toBe('Jio IPO: what to expect\n\nExperts discuss the Jio Platforms IPO.')
    expect(v1.reachRaw).toEqual({ views: 50000, likes: 900, comments: 120 })
    expect(v1.author).toMatchObject({
      platform: 'youtube',
      platformUserId: 'UCcnbc',
      displayName: 'CNBC-TV18',
      kind: 'media_outlet',
    })
    expect(v1.publishedAt.toISOString()).toBe('2026-10-15T08:00:00.000Z')
    expect(res.posts.find((p) => p.externalId === 'video:vid2')!.author?.kind).toBe('other')
    expect(res.costUsd).toBe(0)
  })

  it('maps comments and keeps only those newer than since', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    const c = res.posts.find((p) => p.externalId === 'comment:cm1')!
    expect(c.url).toBe('https://www.youtube.com/watch?v=vid1&lc=cm1')
    expect(c.text).toBe('Jio IPO me paisa lagana chahiye?')
    expect(c.reachRaw).toEqual({ likes: 7, replies: 2 })
    expect(c.author).toMatchObject({ platform: 'youtube', platformUserId: 'UCamit', kind: 'other' })
    expect(res.posts.some((p) => p.externalId === 'comment:cm2')).toBe(false)
    expect(res.posts.some((p) => p.externalId === 'comment:cm3')).toBe(true)
  })

  it('reports quota units in the cursor', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    // search 100 + videos 1 + 2 comment pages
    expect(quotaOf(res)).toEqual({
      day: '2026-10-16',
      unitsUsedToday: 103,
      limit: 10000,
      resetsAt: '2026-10-17T07:00:00.000Z',
    })
    const cur = JSON.parse(res.nextCursor!) as {
      v: number
      tracked: { id: string; views: number }[]
    }
    expect(cur.v).toBe(1)
    expect(cur.tracked.map((t) => t.id)).toEqual(['vid1', 'vid2'])
    expect(cur.tracked[0]).toMatchObject({ id: 'vid1', views: 50000 })
  })

  it('skips search when the allowance is spent but keeps polling comments', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const adapter = createYoutubeAdapter({ now: () => NOW })
    const first = await adapter.fetch(ctx())
    const cursor = JSON.parse(first.nextCursor!) as { quota: { unitsUsedToday: number } }
    cursor.quota.unitsUsedToday = Math.ceil(allowance(NOW)) - 100 // + 121 > allowance
    s.calls.length = 0
    const res = await adapter.fetch(ctx({ cursor: JSON.stringify(cursor) }))
    expect(kinds(s.calls, 'search')).toHaveLength(0)
    expect(kinds(s.calls, 'videos')).toHaveLength(0)
    expect(kinds(s.calls, 'comments')).toHaveLength(2)
    expect(quotaOf(res).unitsUsedToday).toBe(cursor.quota.unitsUsedToday + 2)
  })

  it('stops comment polling at the budget', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const adapter = createYoutubeAdapter({ now: () => NOW })
    const first = await adapter.fetch(ctx())
    const cursor = JSON.parse(first.nextCursor!) as { quota: { unitsUsedToday: number } }
    cursor.quota.unitsUsedToday = BUDGET - 1
    s.calls.length = 0
    const res = await adapter.fetch(ctx({ cursor: JSON.stringify(cursor) }))
    expect(s.calls).toHaveLength(1) // one comment page, then the budget is used
    expect(quotaOf(res).unitsUsedToday).toBe(BUDGET)
  })

  it('resets the counter when the Pacific day changes', async () => {
    const s = server()
    vi.stubGlobal('fetch', s.f)
    const adapter = createYoutubeAdapter({ now: () => NOW })
    const first = await adapter.fetch(ctx())
    const next = new Date('2026-10-17T08:00:00Z') // 01:00 PDT the next day
    const res = await createYoutubeAdapter({ now: () => next }).fetch(
      ctx({ cursor: first.nextCursor, since: new Date('2026-10-16T00:00:00Z') }),
    )
    expect(quotaOf(res).day).toBe('2026-10-17')
    expect(quotaOf(res).unitsUsedToday).toBeLessThan(first.nextCursor ? 200 : 0)
    expect(ptDay(NOW)).toBe('2026-10-16')
  })

  it('tracks the union of previous and new videos from the last 7 days, top 20 by views', async () => {
    const prev = {
      v: 1,
      quota: {
        day: '2026-10-16',
        unitsUsedToday: 0,
        limit: 10000,
        resetsAt: '2026-10-17T07:00:00.000Z',
      },
      tracked: [
        ...Array.from({ length: 22 }, (_, i) => ({
          id: `old${i}`,
          publishedAt: '2026-10-15T00:00:00.000Z',
          views: 100 + i,
        })),
        { id: 'stale', publishedAt: '2026-10-01T00:00:00.000Z', views: 999999 },
      ],
    }
    const s = server({ comments: () => reply('{"items":[]}') })
    vi.stubGlobal('fetch', s.f)
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(
      ctx({ cursor: JSON.stringify(prev) }),
    )
    const cur = JSON.parse(res.nextCursor!) as { tracked: { id: string; views: number }[] }
    expect(cur.tracked).toHaveLength(20)
    expect(cur.tracked.some((t) => t.id === 'stale')).toBe(false)
    expect(cur.tracked[0]!.id).toBe('vid1') // 50000 views
    expect(cur.tracked.map((t) => t.views)).toEqual(
      [...cur.tracked.map((t) => t.views)].sort((a, b) => b - a),
    )
    expect(kinds(s.calls, 'comments').length).toBeLessThanOrEqual(20)
  })

  it('drops a video whose comments are disabled without failing the run', async () => {
    const s = server({
      comments: (url) =>
        url.searchParams.get('videoId') === 'vid2'
          ? reply(fx('error-comments-disabled.json'), 403)
          : reply(fx('comments-vid1.json')),
    })
    vi.stubGlobal('fetch', s.f)
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(ctx())
    const cur = JSON.parse(res.nextCursor!) as { tracked: { id: string }[] }
    expect(cur.tracked.map((t) => t.id)).toEqual(['vid1'])
    expect(res.posts.some((p) => p.externalId === 'video:vid2')).toBe(true)
  })

  it('maps quotaExceeded to RateLimitedError at the next Pacific midnight', async () => {
    const s = server({ search: () => reply(fx('error-quota.json'), 403) })
    vi.stubGlobal('fetch', s.f)
    const err = await createYoutubeAdapter({ now: () => NOW })
      .fetch(ctx())
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as RateLimitedError).resetAt.toISOString()).toBe('2026-10-17T07:00:00.000Z')
  })

  it('maps keyInvalid (400 and 403) to SourceAuthError', async () => {
    for (const status of [400, 403]) {
      vi.stubGlobal(
        'fetch',
        server({ search: () => reply(fx('error-key-invalid.json'), status) }).f,
      )
      await expect(createYoutubeAdapter({ now: () => NOW }).fetch(ctx())).rejects.toBeInstanceOf(
        SourceAuthError,
      )
    }
  })

  it('serves fixtures with zero network calls in fixture mode', async () => {
    vi.stubGlobal('fetch', createFakeFetch([]))
    const res = await createYoutubeAdapter({ now: () => NOW }).fetch(ctx({ mode: 'fixture' }))
    expect(res.posts.length).toBeGreaterThan(0)
  })

  it('stays at or below 9,000 units over 96 runs at 15-minute spacing', async () => {
    const start = Date.parse('2026-10-15T07:00:00Z') // PT midnight
    let t = new Date(start)
    let n = 0
    let serverUnits = 0
    let searchRuns = 0
    const f = createFakeFetch([
      [
        /youtube\/v3\/search\?/,
        () => {
          serverUnits += 100
          searchRuns += 1
          const items = [1, 2, 3].map((i) => ({
            id: { videoId: `s${n}x${i}` },
            snippet: {
              publishedAt: new Date(t.getTime() - 600_000).toISOString(),
              channelId: 'UC',
              channelTitle: 'X',
              title: `Jio IPO ${n}${i}`,
              description: '',
            },
          }))
          n += 1
          return reply(JSON.stringify({ items }))
        },
      ],
      [
        /youtube\/v3\/videos\?/,
        (u) => {
          serverUnits += 1
          const ids = (new URL(u).searchParams.get('id') ?? '').split(',')
          return reply(
            JSON.stringify({
              items: ids.map((id, i) => ({
                id,
                snippet: {
                  publishedAt: new Date(t.getTime() - 600_000).toISOString(),
                  channelId: 'UC',
                  channelTitle: 'X',
                  title: `Jio IPO ${id}`,
                  description: '',
                },
                statistics: {
                  viewCount: String(1000 + i * 10 + searchRuns),
                  likeCount: '1',
                  commentCount: '1',
                },
              })),
            }),
          )
        },
      ],
      [
        /youtube\/v3\/commentThreads\?/,
        () => {
          serverUnits += 1
          return reply('{"items":[]}')
        },
      ],
    ])
    vi.stubGlobal('fetch', f)
    const adapter = createYoutubeAdapter({ now: () => t })
    let cursor: string | undefined
    for (let k = 0; k < 96; k++) {
      t = new Date(start + k * 15 * 60_000)
      const res = await adapter.fetch(ctx({ cursor, since: new Date(t.getTime() - 15 * 60_000) }))
      cursor = res.nextCursor
    }
    expect(serverUnits).toBeLessThanOrEqual(9000)
    expect(quotaOf({ nextCursor: cursor } as FetchResult).unitsUsedToday).toBe(serverUnits)
    expect(searchRuns).toBeGreaterThanOrEqual(60)
  })
})

describe('allowance', () => {
  it('starts at 200, grows over the Pacific day and caps at the budget', () => {
    expect(allowance(new Date('2026-10-15T07:00:00Z'))).toBe(200)
    expect(allowance(new Date('2026-10-15T19:00:00Z'))).toBeCloseTo(4700) // noon PT
    expect(allowance(new Date('2026-10-16T06:59:00Z'))).toBe(BUDGET)
  })
})

describe('buildYoutubeQuery', () => {
  it('joins quoted phrases with | within 400 chars including Hindi and Gujarati', () => {
    const q = buildYoutubeQuery(DEFAULT_CONFIG.terms)
    expect(q.length).toBeLessThanOrEqual(400)
    expect(q).toContain('"Jio IPO"')
    expect(q).toContain('|')
    expect(q).toMatch(/[ऀ-ॿ]/)
    expect(q).toMatch(/[઀-૿]/)
    expect(
      q
        .replace(/"[^"]*"/g, '')
        .replace(/\|/g, '')
        .trim(),
    ).toBe('')
  })
})

describe('YOUTUBE_NEWS_CHANNELS', () => {
  it('matches the finance news channels only', () => {
    for (const n of [
      'CNBC-TV18',
      'CNBC Awaaz',
      'ET Now',
      'Zee Business',
      'NDTV Profit',
      'Moneycontrol',
      'Business Standard',
      'Mint',
      'Economic Times',
      'Business Today',
    ]) {
      expect(YOUTUBE_NEWS_CHANNELS.test(n)).toBe(true)
    }
    expect(YOUTUBE_NEWS_CHANNELS.test('Finance With Riya')).toBe(false)
    expect(YOUTUBE_NEWS_CHANNELS.test('Minty Fresh Vlogs')).toBe(false)
  })
})
