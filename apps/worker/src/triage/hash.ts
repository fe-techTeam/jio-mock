import { createHash } from 'node:crypto'
import { stripUrlsAndMentions, ZERO_WIDTH_RE } from './text'

const RT_PREFIX_RE = /^\s*rt\s+@[\p{L}\p{M}\p{N}_]+\s*:?\s*/u
const BARE_RT_RE = /^\s*rt\s+/u

/**
 * Text normalized for duplicate detection: NFKC, lowercase, no zero-width characters, no leading
 * 'RT @x:' / 'rt ', no URLs or @mentions, whitespace collapsed. Hashtags are kept.
 */
export function normalizeForHash(text: string): string {
  const s = String(text ?? '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH_RE, '')
    .toLowerCase()
    .replace(RT_PREFIX_RE, '')
    .replace(BARE_RT_RE, '')
  return stripUrlsAndMentions(s).replace(/\s+/g, ' ').trim()
}

/** sha256 hex (64 chars) of normalizeForHash(text). */
export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeForHash(text), 'utf8').digest('hex')
}
