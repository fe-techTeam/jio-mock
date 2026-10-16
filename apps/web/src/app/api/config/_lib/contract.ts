// Settings API types. api-types.ts belongs to 04-01, so the Settings contract lives here.
// Browser-safe: type-only imports from @jio/core.
import type { TermsConfig } from '@jio/core'

export type RetentionDays = { raw_json: number; post_text: number; authors: number }

/** Sources and credentials are deliberately absent: they belong to /api/sources. */
export type ConfigResponse = {
  version: number
  savedAt: string | null
  terms: TermsConfig
  retentionDays: RetentionDays
  minItemsForSplit: number
  activeMinItems24h: number
  personLevelViews: false
}

export type ConfigPatch = {
  baseVersion: number
  terms?: TermsConfig
  retentionDays?: RetentionDays
  minItemsForSplit?: number
  activeMinItems24h?: number
}

export type TestTermsRequest = { terms: TermsConfig }

export type TermSample = { text: string; sourceKey: string; publishedAt: string }

export type TestTermsResponse = {
  total: number
  matchedCurrent: number
  matchedDraft: number
  truncated: boolean
  samples: TermSample[]
}

export type ValidationIssue = { path: string; message: string }

export type SeedTopicRow = {
  slug: string
  name: string
  description: string
  examplePhrases: string[]
  status: string
  items24h: number
}

export type EmergingSample = {
  text: string
  sourceKey: string
  publishedAt: string
  lang: string | null
  glossEn: string | null
}

export type EmergingRow = {
  slug: string
  name: string
  description: string
  createdAt: string
  items24h: number
  samples: EmergingSample[]
}

export type ConfigTopicsResponse = {
  seed: SeedTopicRow[]
  emerging: EmergingRow[]
  unclassified: { count24h: number }
}

export type TopicPatch = {
  slug: string
  name?: string
  description?: string
  examplePhrases?: string[]
}

export type PromoteBody =
  | { action: 'promote'; name?: string; description?: string }
  | { action: 'merge'; intoSlug: string }
  | { action: 'dismiss' }

export type AuditItem = {
  at: string
  kind: string
  ip: string | null
  detail: Record<string, unknown>
}

export type AuditResponse = { items: AuditItem[]; nextCursor: string | null }
