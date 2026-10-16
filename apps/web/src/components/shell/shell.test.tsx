// @vitest-environment jsdom
import type { SourceFreshness } from '@jio/core'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatAge,
  formatCount,
  formatIst,
  formatIstRange,
  pctSplit,
  safeExternalUrl,
} from './format'
import { ApiError } from '@/lib/api'
import { createQueryClient, expiredLoginUrl } from '../providers'
import { FilterBar } from './filter-bar'
import { FreshnessPill, freshnessSummary } from './freshness-pill'
import { StaleBanner } from './stale-banner'
import { nav, replacedParams, resetNav } from './test-utils'
import { parseFilters, useFilters } from './use-filters'

vi.mock('next/navigation', () => import('./test-utils'))

beforeEach(() => resetNav())
afterEach(() => cleanup())

describe('format', () => {
  it('formats times in IST', () => {
    expect(formatIst('2026-10-16T04:00:00Z', 'time')).toBe('09:30 IST')
    expect(formatIst('2026-10-16T04:00:00Z', 'datetime')).toBe('09:30 16 Oct')
    expect(formatIst('2026-10-16T19:05:00Z')).toBe('00:35 IST')
  })

  it('formats an IST range on one day', () => {
    expect(formatIstRange('2026-10-16T03:30:00Z', '2026-10-16T04:30:00Z')).toBe(
      '09:00-10:00 16 Oct IST',
    )
  })

  it('splits counts into integer percentages summing to 100', () => {
    const s = pctSplit({ pos: 1, neu: 1, neg: 1 })
    expect(s.pos + s.neu + s.neg).toBe(100)
    expect(pctSplit({ pos: 2, neu: 1, neg: 1 })).toEqual({ pos: 50, neu: 25, neg: 25 })
    expect(pctSplit({ pos: 0, neu: 0, neg: 0 })).toEqual({ pos: 0, neu: 0, neg: 0 })
    const t = pctSplit({ pos: 7, neu: 7, neg: 1 })
    expect(t.pos + t.neu + t.neg).toBe(100)
  })

  it('only passes http(s) urls through', () => {
    expect(safeExternalUrl('https://x.com/a/status/1')).toBe('https://x.com/a/status/1')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('not a url')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })

  it('formats ages and counts', () => {
    expect(formatAge(4)).toBe('4 min')
    expect(formatAge(119)).toBe('119 min')
    expect(formatAge(185)).toBe('3 h')
    expect(formatCount(1234567)).toBe('12,34,567')
  })
})

describe('filters', () => {
  it('parses known values and falls back to all', () => {
    expect(parseFilters(new URLSearchParams('entity=isha&lane=media'))).toEqual({
      entity: 'isha',
      lane: 'media',
    })
    expect(parseFilters(new URLSearchParams('entity=anant&lane=tv'))).toEqual({
      entity: 'all',
      lane: 'all',
    })
  })

  it('setFilter keeps lane and evidence and replaces without scrolling', () => {
    resetNav('lane=social&evidence=window%3D24h', '/')
    const { result } = renderHook(() => useFilters())
    act(() => result.current.setFilter('entity', 'akash'))
    const p = replacedParams()
    expect(p.get('entity')).toBe('akash')
    expect(p.get('lane')).toBe('social')
    expect(p.get('evidence')).toBe('window=24h')
    expect(nav.replace.mock.calls[0]![1]).toEqual({ scroll: false })
  })

  it('setFilter deletes the key for all', () => {
    resetNav('entity=isha&lane=social', '/topics/gmp')
    const { result } = renderHook(() => useFilters())
    act(() => result.current.setFilter('entity', 'all'))
    expect(String(nav.replace.mock.calls[0]![0])).toBe('/topics/gmp?lane=social')
  })
})

const fresh = (over: Partial<SourceFreshness>): SourceFreshness => ({
  sourceKey: 'reddit',
  lane: 'social',
  enabled: true,
  intervalMin: 5,
  lastSuccessAt: '2026-10-16T04:00:00Z',
  ageMin: 4,
  consecutiveFailures: 0,
  status: 'ok',
  ...over,
})

describe('FreshnessPill', () => {
  it('shows the age range of enabled sources and links to /sources', () => {
    render(
      <FreshnessPill
        freshness={[
          fresh({ ageMin: 4 }),
          fresh({ sourceKey: 'news_rss', ageMin: 18 }),
          fresh({ sourceKey: 'x_api', enabled: false, ageMin: 900 }),
        ]}
      />,
    )
    const link = screen.getByRole('link', { name: /Data 4-18 min old/ })
    expect(link).toHaveAttribute('href', '/sources')
  })

  it('shows a single value when ages are equal and flags stale sources', () => {
    expect(freshnessSummary([fresh({ ageMin: 7 }), fresh({ ageMin: 7, status: 'stale' })])).toEqual(
      { text: 'Data 7 min old', stale: true },
    )
  })

  it('waits for the first fetch when nothing has succeeded', () => {
    render(
      <FreshnessPill
        freshness={[fresh({ ageMin: null, lastSuccessAt: null, status: 'waiting' })]}
      />,
    )
    expect(screen.getByRole('link', { name: /Waiting for first fetch/ })).toBeInTheDocument()
  })
})

describe('StaleBanner', () => {
  it('shows the as-of time in IST and retries', async () => {
    const onRetry = vi.fn()
    render(<StaleBanner asOf="2026-10-16T04:00:00Z" onRetry={onRetry} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Could not refresh, showing data as of 09:30 IST',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('FilterBar', () => {
  it('labels the entity control Mentions and writes the entity param', async () => {
    resetNav('lane=media')
    render(<FilterBar />)
    expect(screen.getByRole('radiogroup', { name: 'Mentions' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Isha' }))
    const p = replacedParams()
    expect(p.get('entity')).toBe('isha')
    expect(p.get('lane')).toBe('media')
  })
})

describe('providers', () => {
  it('sends a 401 to the login page with reason=expired and the current path', async () => {
    expect(expiredLoginUrl({ pathname: '/topics/gmp', search: '?entity=isha' })).toBe(
      '/login?reason=expired&next=%2Ftopics%2Fgmp%3Fentity%3Disha',
    )
    const onUnauthorized = vi.fn()
    const client = createQueryClient(onUnauthorized)
    expect(client.getDefaultOptions().queries).toMatchObject({
      refetchInterval: 30_000,
      staleTime: 15_000,
      retry: 1,
    })
    client.setDefaultOptions({ queries: { retry: false } })
    await client
      .fetchQuery({
        queryKey: ['x'],
        queryFn: () => Promise.reject(new ApiError(401, 'unauthorized')),
      })
      .catch(() => undefined)
    expect(onUnauthorized).toHaveBeenCalledOnce()
    await client
      .fetchQuery({ queryKey: ['y'], queryFn: () => Promise.reject(new ApiError(503, 'db')) })
      .catch(() => undefined)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })
})
