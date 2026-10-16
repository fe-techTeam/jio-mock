// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  REQUIRED_CREDS,
  deriveStatus,
  effectiveIntervalMin,
  minYoutubeIntervalMin,
  nextRunAt,
  resolveMode,
  xModeLabel,
} from './status'

const src = { interval_min: 60, market_hours_interval_min: 10 }
// 2026-10-16 is a Friday. IST = UTC + 5:30.
const ist = (hhmm: string, day = '2026-10-16') => new Date(`${day}T${hhmm}:00+05:30`)

describe('effectiveIntervalMin', () => {
  it('portal uses the market-hours interval at 10:00 IST on a weekday, else the base', () => {
    expect(effectiveIntervalMin('portal_chittorgarh', src, ist('10:00'))).toBe(10)
    expect(effectiveIntervalMin('portal_chittorgarh', src, ist('16:00'))).toBe(60)
  })
  it('09:14 vs 09:15 IST', () => {
    expect(effectiveIntervalMin('portal_ipowatch', src, ist('09:14'))).toBe(60)
    expect(effectiveIntervalMin('portal_ipowatch', src, ist('09:15'))).toBe(10)
  })
  it('Saturday 11:00 IST uses the base interval', () => {
    expect(effectiveIntervalMin('portal_investorgain', src, ist('11:00', '2026-10-17'))).toBe(60)
  })
  it('non-portal sources ignore market hours; null market interval falls back', () => {
    expect(effectiveIntervalMin('reddit', src, ist('10:00'))).toBe(60)
    expect(
      effectiveIntervalMin(
        'portal_ipowatch',
        { interval_min: 60, market_hours_interval_min: null },
        ist('10:00'),
      ),
    ).toBe(60)
  })
})

describe('deriveStatus', () => {
  const now = ist('12:00')
  const mins = (m: number) => new Date(now.getTime() - m * 60_000)
  const base = {
    enabled: true,
    lastRunAt: mins(1),
    lastSuccessAt: mins(1),
    consecutiveFailures: 0,
    effectiveIntervalMin: 10,
    now,
    breakerThreshold: 3,
  }
  it('disabled wins over everything', () => {
    expect(deriveStatus({ ...base, enabled: false, consecutiveFailures: 9 })).toBe('disabled')
  })
  it('waiting when never run', () => {
    expect(deriveStatus({ ...base, lastRunAt: null, lastSuccessAt: null })).toBe('waiting')
  })
  it('circuit_open at the threshold, not below', () => {
    expect(deriveStatus({ ...base, consecutiveFailures: 3 })).toBe('circuit_open')
    expect(deriveStatus({ ...base, consecutiveFailures: 2 })).toBe('ok')
  })
  it('circuit_open wins over stale', () => {
    expect(deriveStatus({ ...base, consecutiveFailures: 4, lastSuccessAt: mins(500) })).toBe(
      'circuit_open',
    )
  })
  it('stale when the last success is older than 2 x interval', () => {
    expect(deriveStatus({ ...base, lastSuccessAt: mins(21) })).toBe('stale')
    expect(deriveStatus({ ...base, lastSuccessAt: mins(20) })).toBe('ok')
  })
  it('stale when it ran but never succeeded', () => {
    expect(deriveStatus({ ...base, lastSuccessAt: null, consecutiveFailures: 1 })).toBe('stale')
  })
})

describe('nextRunAt', () => {
  const last = new Date('2026-10-16T06:00:00Z')
  it('last run + interval', () => {
    expect(nextRunAt({ enabled: true, lastRunAt: last, effectiveIntervalMin: 15 })).toEqual(
      new Date('2026-10-16T06:15:00Z'),
    )
  })
  it('null when disabled or never run', () => {
    expect(nextRunAt({ enabled: false, lastRunAt: last, effectiveIntervalMin: 15 })).toBeNull()
    expect(nextRunAt({ enabled: true, lastRunAt: null, effectiveIntervalMin: 15 })).toBeNull()
  })
})

describe('resolveMode', () => {
  it('knows the required creds per source', () => {
    expect(REQUIRED_CREDS.x_api).toEqual(['X_BEARER_TOKEN'])
    expect(REQUIRED_CREDS.reddit).toEqual(['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'])
    expect(REQUIRED_CREDS.news_rss).toEqual([])
    expect(REQUIRED_CREDS.portal_ipowatch).toEqual([])
    expect(REQUIRED_CREDS.apify_linkedin).toEqual(['APIFY_TOKEN'])
  })
  it('fixture forces fixture, live forces live', () => {
    expect(resolveMode('news_rss', { SOURCES_MODE: 'fixture' }, [])).toEqual({
      mode: 'fixture',
      missingCreds: [],
    })
    expect(resolveMode('reddit', { SOURCES_MODE: 'live' }, [])).toEqual({
      mode: 'live',
      missingCreds: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'],
    })
  })
  it('auto is live only when every cred is present (env or config)', () => {
    expect(resolveMode('reddit', { REDDIT_CLIENT_ID: 'a' }, [])).toEqual({
      mode: 'fixture',
      missingCreds: ['REDDIT_CLIENT_SECRET'],
    })
    expect(
      resolveMode('reddit', { REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b' }, []).mode,
    ).toBe('live')
    expect(resolveMode('x_api', {}, ['X_BEARER_TOKEN']).mode).toBe('live')
    expect(resolveMode('x_api', { SOURCES_MODE: 'auto' }, []).mode).toBe('fixture')
  })
  it('keyless sources are live in auto; empty env values count as missing', () => {
    expect(resolveMode('portal_chittorgarh', {}, []).mode).toBe('live')
    expect(resolveMode('youtube', { YOUTUBE_API_KEY: '' }, []).mode).toBe('fixture')
  })
})

describe('xModeLabel', () => {
  it('Official API only when x_api is enabled and live', () => {
    expect(xModeLabel(true, 'live')).toBe('Official API')
    expect(xModeLabel(true, 'fixture')).toBe('Apify fallback')
    expect(xModeLabel(false, 'live')).toBe('Apify fallback')
  })
})

describe('youtube quota rule', () => {
  it('minimum interval keeps ceil(1440/i) x 100 within 10,000 units', () => {
    expect(minYoutubeIntervalMin()).toBe(15)
    expect(Math.ceil(1440 / 15) * 100).toBeLessThanOrEqual(10_000)
    expect(Math.ceil(1440 / 14) * 100).toBeGreaterThan(10_000)
  })
})
