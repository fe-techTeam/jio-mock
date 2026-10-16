import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SENTIMENT_COLORS, SENTIMENT_CLASSES } from './sentiment-colors'

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  )
}
/** WCAG 2.x contrast ratio. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('contrast helper', () => {
  it('black on white is 21:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
  })
})

describe('SENTIMENT_COLORS', () => {
  it('uses the agreed palette', () => {
    expect(SENTIMENT_COLORS.light).toEqual({
      positive: '#15803d',
      neutral: '#64748b',
      negative: '#b91c1c',
    })
    expect(SENTIMENT_COLORS.dark).toEqual({
      positive: '#4ade80',
      neutral: '#94a3b8',
      negative: '#f87171',
    })
  })

  it.each(['positive', 'neutral', 'negative'] as const)(
    '%s is at least 4.5:1 in light mode',
    (s) => {
      expect(contrast(SENTIMENT_COLORS.light[s], '#ffffff')).toBeGreaterThanOrEqual(4.5)
    },
  )

  it.each(['positive', 'neutral', 'negative'] as const)(
    '%s is at least 4.5:1 in dark mode',
    (s) => {
      expect(contrast(SENTIMENT_COLORS.dark[s], '#0a0a0a')).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('the Tailwind classes carry exactly these colours', () => {
    for (const s of ['positive', 'neutral', 'negative'] as const) {
      for (const cls of [SENTIMENT_CLASSES[s].bar, SENTIMENT_CLASSES[s].text]) {
        expect(cls).toContain(SENTIMENT_COLORS.light[s])
        expect(cls).toContain(SENTIMENT_COLORS.dark[s])
      }
    }
  })

  it('no component spells a sentiment colour itself', () => {
    const root = join(__dirname, '..')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(p)
      }
    }
    walk(root)
    const all = Object.values(SENTIMENT_COLORS).flatMap((m) => Object.values(m))
    const raw = /#(16a34a|dc2626)/i
    for (const f of files) {
      if (f.endsWith('sentiment-colors.ts')) continue
      const src = readFileSync(f, 'utf8')
      for (const hex of all) expect(src.toLowerCase(), f).not.toContain(hex)
      expect(src, f).not.toMatch(raw)
    }
  })
})
