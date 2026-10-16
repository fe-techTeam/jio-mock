// Source adapter contract (CONTRACTS.md "Worker"). Copied verbatim, plus NormalizedPost.lane.
import type { SourceConfig, TermsConfig } from './config-schema'
import type { AuthorKind, Lane, MarketSeries, SourceKey } from './types'

export interface NormalizedAuthor {
  platform: string
  platformUserId: string
  handle?: string
  displayName?: string
  followers?: number
  kind?: AuthorKind
}

export interface NormalizedPost {
  sourceKey: SourceKey
  externalId: string
  url: string
  author: NormalizedAuthor | null
  text: string
  publishedAt: Date
  reachRaw: Record<string, number>
  rawJson: unknown
  /**
   * Overrides the source's default lane for this post (01-01 addition): web_search marks
   * site:instagram.com hits as social, YouTube news channels as media.
   */
  lane?: Lane
}

export interface NormalizedMarketPoint {
  series: MarketSeries
  value: number
  observedAt: Date
  sourceKey: SourceKey
  sourceUrl: string
}

export interface FetchContext {
  since: Date
  cursor?: string
  source: SourceConfig
  terms: TermsConfig
  mode: 'live' | 'fixture'
  signal: AbortSignal
  creds: Record<string, string | undefined>
}

export interface FetchResult {
  posts: NormalizedPost[]
  marketPoints?: NormalizedMarketPoint[]
  nextCursor?: string
  costUsd: number
}

export interface SourceAdapter {
  key: SourceKey
  lane: Lane
  requiredCreds: string[]
  fetch(ctx: FetchContext): Promise<FetchResult>
}
