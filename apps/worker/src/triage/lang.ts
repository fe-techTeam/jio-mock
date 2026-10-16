import type { Lang } from '@jio/core'
import { stripHashtags, stripUrlsAndMentions, ZERO_WIDTH_RE } from './text'

/** Romanized-Hindi words that mark Latin-script text as Hinglish. */
export const HINGLISH_MARKERS: readonly string[] = [
  'hai',
  'hain',
  'ka',
  'ki',
  'ke',
  'ko',
  'nahi',
  'kya',
  'kitna',
  'kitni',
  'kab',
  'lagau',
  'lagao',
  'karu',
  'karo',
  'mila',
  'milega',
  'lena',
  'chahiye',
  'bhai',
  'yaar',
  'acha',
  'accha',
  'aur',
  'bhi',
  'toh',
  'mein',
  'se',
  'wala',
  'raha',
  'rahe',
  'paisa',
  'dekho',
  'sahi',
  'bahut',
]
const MARKER_SET: ReadonlySet<string> = new Set(HINGLISH_MARKERS)

/** Share of word tokens a script needs to claim the post. */
const SCRIPT_SHARE = 0.3
const MARKER_MIN_HITS = 2
const MARKER_MIN_SHARE = 0.15

type Script = 'deva' | 'gujr' | 'latn' | 'other'

const WORD_RE = /[\p{L}\p{M}]+/gu
const LATIN_RE = /\p{Script=Latin}/u

function scriptOf(ch: string): Script {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 0x0900 && cp <= 0x097f) return 'deva'
  if (cp >= 0x0a80 && cp <= 0x0aff) return 'gujr'
  if (LATIN_RE.test(ch)) return 'latn'
  return 'other'
}

/** A word's script is the script of most of its letters (combining marks follow their base). */
function wordScript(word: string): Script {
  const counts: Record<Script, number> = { deva: 0, gujr: 0, latn: 0, other: 0 }
  for (const ch of word) {
    if (/\p{M}/u.test(ch)) continue
    counts[scriptOf(ch)]++
  }
  let best: Script = 'other'
  let max = 0
  for (const s of ['deva', 'gujr', 'latn', 'other'] as const) {
    if (counts[s] > max) {
      best = s
      max = counts[s]
    }
  }
  return best
}

/**
 * Detects the language of a post: 'gu' / 'hi' when Gujarati / Devanagari words make up at least
 * 30% of the words, else for mostly-Latin text 'hinglish' (romanized-Hindi markers) or 'en',
 * else 'other'. Hashtags, URLs and @mentions are ignored.
 *
 * Shares are counted per word (each word takes its majority script) rather than per letter, so a
 * short mixed post such as 'जियो IPO allotment' is Hindi: by letters it would be only 25%.
 */
export function detectLang(text: string): Lang {
  const cleaned = stripHashtags(stripUrlsAndMentions(String(text ?? '')))
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
  const words = cleaned.match(WORD_RE) ?? []
  if (words.length === 0) return 'other'

  const counts: Record<Script, number> = { deva: 0, gujr: 0, latn: 0, other: 0 }
  const latinWords: string[] = []
  for (const w of words) {
    const s = wordScript(w)
    counts[s]++
    if (s === 'latn') latinWords.push(w.toLowerCase())
  }
  const total = words.length
  if (counts.gujr / total >= SCRIPT_SHARE) return 'gu'
  if (counts.deva / total >= SCRIPT_SHARE) return 'hi'
  if (counts.latn / total < 0.5) return 'other'

  const hits = latinWords.filter((w) => MARKER_SET.has(w)).length
  if (hits >= MARKER_MIN_HITS || hits / latinWords.length >= MARKER_MIN_SHARE) return 'hinglish'
  return 'en'
}
