import { describe, expect, it } from 'vitest'
import { LANGS } from '@jio/core'
import { detectLang, HINGLISH_MARKERS } from './lang'

describe('detectLang', () => {
  it.each([
    ['Jio IPO GMP kitna chal raha hai bhai', 'hinglish'],
    ['Jio IPO price band looks expensive', 'en'],
    ['जियो आईपीओ का जीएमपी', 'hi'],
    ['જિયો આઈપીઓ ક્યારે', 'gu'],
    ['जियो IPO allotment', 'hi'],
    ['🚀🚀🔥', 'other'],
    ['', 'other'],
    ['ஜியோ ஐபிஓ எப்போது வரும்', 'other'],
    ['জিও আইপিও কবে আসবে', 'other'],
  ] as const)('%s -> %s', (text, lang) => {
    expect(detectLang(text)).toBe(lang)
  })

  it('ignores hashtags, URLs and @mentions when counting', () => {
    // Without stripping, the Latin hashtag, mention and URL would outweigh the Hindi words.
    expect(detectLang('जियो आईपीओ #JioIPOGMP #RelianceJioIPO @someuser https://t.co/abcdef')).toBe(
      'hi',
    )
    expect(detectLang('#JioIPO https://t.co/x @hai_bhai')).toBe('other')
  })

  it('a single marker in a long English sentence stays en', () => {
    expect(
      detectLang(
        'Analysts say the Jio IPO valuation is rich but demand from retail se looks strong today',
      ),
    ).toBe('en')
  })

  it('one marker in a short sentence (>= 15% of tokens) is hinglish', () => {
    expect(detectLang('Jio IPO lena chahiye?')).toBe('hinglish')
  })

  it('always returns a Lang', () => {
    for (const t of ['x', '123', '...', 'Jio', 'जियो', 'جیو آئی پی او']) {
      expect(LANGS).toContain(detectLang(t))
    }
  })

  it('exports the romanized-Hindi marker list', () => {
    expect(HINGLISH_MARKERS).toContain('kitna')
    expect(HINGLISH_MARKERS).toContain('bahut')
  })
})
