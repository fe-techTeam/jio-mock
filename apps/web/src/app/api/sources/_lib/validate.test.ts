// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@jio/core'
import { parsePatch, validatePatch } from './validate'

const cfg = () => structuredClone(DEFAULT_CONFIG)
const paths = (p: unknown) => validatePatch(parsePatch(p), cfg()).map((i) => i.path.join('.'))

describe('validatePatch', () => {
  it('accepts a normal interval change', () => {
    expect(paths({ baseVersion: 1, sources: { reddit: { interval_min: 7 } } })).toEqual([])
  })
  it.each([0, -1, 1441, 1.5])('rejects interval_min %s', (v) => {
    const got = paths({ baseVersion: 1, sources: { reddit: { interval_min: v } } })
    expect(got).toContain('sources.reddit.interval_min')
  })
  it('rejects youtube below 15 and accepts 15', () => {
    expect(paths({ baseVersion: 1, sources: { youtube: { interval_min: 10 } } })).toEqual([
      'sources.youtube.interval_min',
    ])
    expect(paths({ baseVersion: 1, sources: { youtube: { interval_min: 15 } } })).toEqual([])
  })
  it('market-hours interval only for portals, at most interval_min', () => {
    expect(
      paths({ baseVersion: 1, sources: { reddit: { market_hours_interval_min: 5 } } }),
    ).toEqual(['sources.reddit.market_hours_interval_min'])
    expect(
      paths({
        baseVersion: 1,
        sources: { portal_ipowatch: { interval_min: 30, market_hours_interval_min: 31 } },
      }),
    ).toEqual(['sources.portal_ipowatch.market_hours_interval_min'])
    expect(
      paths({
        baseVersion: 1,
        sources: { portal_ipowatch: { interval_min: 30, market_hours_interval_min: 30 } },
      }),
    ).toEqual([])
  })
  it('rejects an unknown source key', () => {
    expect(paths({ baseVersion: 1, sources: { nope: { interval_min: 5 } } })).toEqual([
      'sources.nope',
    ])
  })
  it('bearer token rules', () => {
    const t = (bearerToken: string | null) => paths({ baseVersion: 1, x: { bearerToken } })
    expect(t('a'.repeat(19))).toEqual(['x.bearerToken'])
    expect(t('a'.repeat(513))).toEqual(['x.bearerToken'])
    expect(t('abc def'.padEnd(30, 'x'))).toEqual(['x.bearerToken'])
    expect(t('  ' + 'a'.repeat(30) + '  ')).toEqual([])
    expect(t(null)).toEqual([])
  })
  it('x tier must be a known tier or null', () => {
    expect(paths({ baseVersion: 1, x: { x_tier: 'gold' } })).toEqual(['x.x_tier'])
    expect(paths({ baseVersion: 1, x: { x_tier: 'basic' } })).toEqual([])
  })
  it('rejects a body with nothing to change or the wrong shape', () => {
    expect(paths({ baseVersion: 1 })).toEqual(['body'])
    expect(() => parsePatch({ sources: {} })).toThrow()
    expect(() => parsePatch({ baseVersion: 1, extra: true })).toThrow()
  })
})
