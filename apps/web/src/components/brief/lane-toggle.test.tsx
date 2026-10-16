// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { LANE_OPTIONS, laneHref, parseLane } from './lane-toggle'
import { formatSplit } from './reach-split'

const sp = (s: string) => new URLSearchParams(s)

describe('LANE_OPTIONS', () => {
  it('lists All, Social and Media and analyst', () => {
    expect(LANE_OPTIONS).toEqual([
      { value: 'all', label: 'All' },
      { value: 'social', label: 'Social' },
      { value: 'media', label: 'Media and analyst' },
    ])
  })
})

describe('parseLane', () => {
  it('accepts social and media', () => {
    expect(parseLane('social')).toBe('social')
    expect(parseLane('media')).toBe('media')
  })
  it('falls back to all for unknown, empty or missing values', () => {
    expect(parseLane('x')).toBe('all')
    expect(parseLane('')).toBe('all')
    expect(parseLane(null)).toBe('all')
    expect(parseLane('all')).toBe('all')
  })
})

describe('laneHref', () => {
  it('sets lane and keeps entity and evidence', () => {
    const href = laneHref('/', sp('entity=isha&evidence=window%3D24h'), 'media')
    const url = new URL(href, 'http://x')
    expect(url.pathname).toBe('/')
    expect(url.searchParams.get('lane')).toBe('media')
    expect(url.searchParams.get('entity')).toBe('isha')
    expect(url.searchParams.get('evidence')).toBe('window=24h')
  })

  it('replaces an existing lane', () => {
    expect(laneHref('/topics/gmp', sp('lane=social&entity=jio'), 'media')).toBe(
      '/topics/gmp?lane=media&entity=jio',
    )
  })

  it('lane=all strips the param', () => {
    expect(laneHref('/', sp('lane=media&entity=isha'), 'all')).toBe('/?entity=isha')
    expect(laneHref('/topics/gmp', sp('lane=social'), 'all')).toBe('/topics/gmp')
  })

  it('does not mutate the params it was given', () => {
    const params = sp('entity=isha')
    laneHref('/', params, 'media')
    expect(params.toString()).toBe('entity=isha')
  })
})

describe('formatSplit', () => {
  it('formats a split as whole percents separated by slashes', () => {
    expect(formatSplit({ pos: 42, neu: 31, neg: 27 })).toBe('42 / 31 / 27')
  })
  it('never shows decimals', () => {
    expect(formatSplit({ pos: 41.6, neu: 31.2, neg: 27.2 })).toBe('42 / 31 / 27')
  })
})
