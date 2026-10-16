import { matchTerms, type MatchResult, type TermsConfig } from '@jio/core'
import { stripUrlsAndMentions } from './text'

export type RelevanceReason = 'match' | 'no_match' | 'negative_term'

export type Relevance = {
  relevant: boolean
  /** Config spellings of the terms behind a match; [] when not relevant. */
  matchedTerms: string[]
  reason: RelevanceReason
}

const REASON: Record<MatchResult['reason'], RelevanceReason> = {
  strong: 'match',
  anchor_cooccurrence: 'match',
  anchor_pair: 'match',
  negative: 'negative_term',
  none: 'no_match',
}

/**
 * Keyword relevance via the @jio/core matcher. URLs and @handles are removed first, so a link
 * such as https://x.com/jio_ipo cannot make a post relevant (SUMMARY-01-01 note).
 */
export function assessRelevance(text: string, terms: TermsConfig): Relevance {
  const r = matchTerms(stripUrlsAndMentions(String(text ?? '')), terms)
  return {
    relevant: r.relevant,
    matchedTerms: r.relevant ? r.matchedTerms : [],
    reason: REASON[r.reason],
  }
}
