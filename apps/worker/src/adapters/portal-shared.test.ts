import { describe, expect, it } from 'vitest'
import { load } from 'cheerio'
import { compileMatcher, DEFAULT_CONFIG } from '@jio/core'
import { SourceParseError } from '../breaker'
import {
  extractGmp,
  extractNewsLinks,
  extractSubscription,
  findIssuerRow,
  findTable,
  parseNumber,
  parseObservedAt,
  pickColumn,
  withinBounds,
} from './portal-shared'

const NOW = new Date('2026-10-16T09:00:00Z')
const ctx = (key = 'portal_chittorgarh' as const) => ({
  key,
  observedAt: NOW,
  sourceUrl: 'https://example.test/page',
})

describe('parseNumber', () => {
  it.each([
    ['₹45 (12.50%)', 45],
    ['Rs. 1,250', 1250],
    ['-₹10', -10],
    ['12.34x', 12.34],
    ['1,234.5 times', 1234.5],
    ['0', 0],
  ])('reads %s as %d', (raw, expected) => {
    expect(parseNumber(raw)).toBe(expected)
  })
  it.each(['--', '-', 'NA', '', '  ', '14 Oct - 16 Oct', '12-15'])('reads %j as null', (raw) => {
    expect(parseNumber(raw)).toBeNull()
  })
})

describe('findTable', () => {
  it('finds a thead/th table and returns headers and body rows', () => {
    const $ = load(
      '<table><thead><tr><th>IPO</th><th>GMP</th></tr></thead><tbody><tr><td>A</td><td>5</td></tr></tbody></table>',
    )
    const t = findTable($, [/ipo/i, /gmp/i])
    expect(t?.headers).toEqual(['ipo', 'gmp'])
    expect(t?.rows).toEqual([['A', '5']])
  })
  it('finds a table whose header is the first row of td cells', () => {
    const $ = load(
      '<table><tr><td>Name</td><td>GMP(₹)</td></tr><tr><td>A</td><td>5</td></tr></table>',
    )
    expect(findTable($, [/name/i, /gmp/i])?.rows).toEqual([['A', '5']])
  })
  it('ignores tables missing a required column', () => {
    const $ = load(
      '<table><tr><th>IPO</th><th>Price</th></tr></table><table><tr><th>IPO</th><th>GMP</th></tr></table>',
    )
    expect(findTable($, [/ipo/i, /gmp/i])?.headers).toEqual(['ipo', 'gmp'])
    expect(findTable(load('<table><tr><th>IPO</th></tr></table>'), [/gmp/i])).toBeNull()
  })
})

describe('pickColumn', () => {
  it('prefers an exact NII header over bNII and sNII', () => {
    expect(pickColumn(['company', 'bnii', 'snii', 'nii (x)', 'rii'], 'nii')).toBe(3)
  })
  it('falls back to HNI', () => {
    expect(pickColumn(['company', 'qib', 'hni', 'retail'], 'nii')).toBe(2)
  })
  it('maps RII and Retail to retail', () => {
    expect(pickColumn(['x', 'rii'], 'retail')).toBe(1)
    expect(pickColumn(['x', 'retail (x)'], 'retail')).toBe(1)
  })
  it.each([['gmp'], ['ipo gmp'], ['gmp (₹)'], ['gmp(₹)']])('picks %s for gmp', (h) => {
    expect(pickColumn(['ipo name', h], 'gmp')).toBe(1)
  })
  it('never picks GMP %, Est. Listing or Kostak for gmp', () => {
    expect(pickColumn(['name', 'gmp %', 'est. listing', 'kostak'], 'gmp')).toBe(-1)
  })
  it('does not take the IPO GMP header as the name column', () => {
    expect(pickColumn(['ipo gmp', 'ipo name'], 'name')).toBe(1)
  })
})

describe('findIssuerRow', () => {
  const rows = (name: string) => [
    ['Other Ltd', '1'],
    [name, '2'],
  ]
  it.each(['Jio Platforms Ltd.', 'JIO PLATFORMS IPO', 'Reliance Jio Platforms'])(
    'matches %s',
    (name) => {
      expect(findIssuerRow(rows(name), 0)?.[1]).toBe('2')
    },
  )
  it.each(['Jio Financial Services', 'JFS', 'Jio Financial Services Ltd IPO'])(
    'does not match %s',
    (name) => {
      expect(findIssuerRow(rows(name), 0)).toBeNull()
    },
  )
})

describe('parseObservedAt', () => {
  it('reads dd-Mon-yyyy HH:mm as IST', () => {
    expect(parseObservedAt('Last Updated: 16-Oct-2026 14:05', NOW).toISOString()).toBe(
      '2026-10-16T08:35:00.000Z',
    )
  })
  it('reads a 12-hour clock as IST', () => {
    expect(parseObservedAt('16 Oct 2026, 2:05 PM', NOW).toISOString()).toBe(
      '2026-10-16T08:35:00.000Z',
    )
  })
  it('falls back to now', () => {
    expect(parseObservedAt('no date here', NOW)).toEqual(NOW)
  })
})

describe('withinBounds', () => {
  it('drops gmp outside [-5000, 5000] and subscription outside [0, 5000]', () => {
    expect(withinBounds('gmp_inr', 5001)).toBe(false)
    expect(withinBounds('gmp_inr', -5000)).toBe(true)
    expect(withinBounds('sub_total_x', -0.1)).toBe(false)
    expect(withinBounds('sub_total_x', 5001)).toBe(false)
    expect(withinBounds('sub_qib_x', 0)).toBe(true)
  })
})

const GMP_HTML = `<table><thead><tr><th>IPO Name</th><th>GMP (₹)</th><th>GMP %</th></tr></thead><tbody>
<tr><td>Jio Financial Services</td><td>999</td><td>9</td></tr>
<tr><td>Jio Platforms Ltd.</td><td>₹45 (12.50%)</td><td>12</td></tr></tbody></table>`

describe('extractGmp', () => {
  it('returns the Jio Platforms gmp and never the decoy', () => {
    const pts = extractGmp(load(GMP_HTML), ctx())
    expect(pts).toEqual([
      {
        series: 'gmp_inr',
        value: 45,
        observedAt: NOW,
        sourceKey: 'portal_chittorgarh',
        sourceUrl: 'https://example.test/page',
      },
    ])
  })
  it('returns [] when the table has no issuer row', () => {
    const html =
      '<table><tr><th>IPO Name</th><th>GMP</th></tr><tr><td>Acme</td><td>3</td></tr></table>'
    expect(extractGmp(load(html), ctx())).toEqual([])
  })
  it('drops an out-of-bounds value', () => {
    const html =
      '<table><tr><th>IPO Name</th><th>GMP</th></tr><tr><td>Jio Platforms</td><td>90000</td></tr></table>'
    expect(extractGmp(load(html), ctx())).toEqual([])
  })
  it('throws SourceParseError when no GMP table exists', () => {
    const run = () => extractGmp(load('<div id="app"></div>'), ctx())
    expect(run).toThrow(SourceParseError)
    expect(run).toThrow('portal_chittorgarh: GMP table not found')
  })
})

const SUB_HTML = `<table><tr><td>Company</td><td>QIB</td><td>bNII</td><td>NII</td><td>RII</td><td>Total</td></tr>
<tr><td>Jio Platforms Ltd</td><td>6.8</td><td>1</td><td>9.15</td><td>-</td><td>5.37x</td></tr></table>`

describe('extractSubscription', () => {
  it('returns one point per non-null series', () => {
    const pts = extractSubscription(load(SUB_HTML), ctx())
    expect(pts.map((p) => [p.series, p.value])).toEqual([
      ['sub_qib_x', 6.8],
      ['sub_nii_x', 9.15],
      ['sub_total_x', 5.37],
    ])
  })
  it('throws SourceParseError when the table is missing', () => {
    expect(() => extractSubscription(load('<p>x</p>'), ctx())).toThrow(
      'portal_chittorgarh: subscription table not found',
    )
  })
})

describe('extractNewsLinks', () => {
  const matcher = compileMatcher(DEFAULT_CONFIG.terms)
  const portal = {
    key: 'portal_chittorgarh' as const,
    name: 'Chittorgarh',
    domain: 'chittorgarh.com',
  }
  const html = `<a href="/n/1" title="More on this">Jio Platforms IPO subscribed 5.37 times on day 3</a>
  <a href="/n/1">Jio Platforms IPO subscribed 5.37 times on day 3</a>
  <a href="/n/2">Jio IPO</a>
  <a href="/n/3">Arunodaya Cables IPO review: apply or avoid today?</a>
  <a href="javascript:void(0)">Jio Platforms IPO subscribed 5.37 times on day 3</a>`
  it('keeps long relevant anchors, resolves urls and dedupes by href', () => {
    const posts = extractNewsLinks(
      load(html),
      'https://www.chittorgarh.com/report/x/',
      portal,
      matcher,
      NOW,
    )
    expect(posts).toHaveLength(1)
    const p = posts[0]!
    expect(p.url).toBe('https://www.chittorgarh.com/n/1')
    expect(p.externalId).toMatch(/^portal_chittorgarh:[0-9a-f]{16}$/)
    expect(p.text).toContain('More on this')
    expect(p.publishedAt).toEqual(NOW)
    expect(p.author).toMatchObject({
      platform: 'portal',
      platformUserId: 'chittorgarh.com',
      kind: 'media_outlet',
    })
  })
})
