// Web API request/response types (CONTRACTS.md "Web API").
// Skeleton from 01-01. 04-01 owns this file next and adds BriefResponse, TimelineResponse and EvidencePage.
import type { EntityKey, Sentiment } from './types'

export type HealthResponse = { ok: true; db: 'up' | 'down' }

export type ApiErrorBody = { error: string; issues?: unknown }

export type LabelRequest = {
  postId: string
  origin: 'correction' | 'gold'
  sentiment: Sentiment
  topicSlug: string
  entities: EntityKey[]
}

export type LabelResponse = { ok: true }
