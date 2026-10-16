// Shared text cleanup for triage. URLs and @handles carry no language or relevance signal
// ('https://x.com/jio_ipo' would otherwise match 'Jio IPO'), so they are removed first.

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu
// '@' not preceded by a word character, so 'ipo@jio.com' is left alone.
const MENTION_RE = /(?<![\p{L}\p{M}\p{N}_])@[\p{L}\p{M}\p{N}_]+/gu
const HASHTAG_RE = /(?<![\p{L}\p{M}\p{N}_])#[\p{L}\p{M}\p{N}_]+/gu
export const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g

export function stripUrlsAndMentions(text: string): string {
  return text.replace(URL_RE, ' ').replace(MENTION_RE, ' ')
}

export function stripHashtags(text: string): string {
  return text.replace(HASHTAG_RE, ' ')
}
