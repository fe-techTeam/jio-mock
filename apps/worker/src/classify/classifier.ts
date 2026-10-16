// Stage two of classification: the Classifier contract shared by the Anthropic and stub
// implementations, plus the normalization every raw label passes through. Anything the model (or
// the stub) returns that is unsure, unknown or malformed ends up as topic 'unclassified' with
// confidence 'low', so the dashboard never shows an invented topic.
import { z } from 'zod'
import { CONFIDENCES, ENTITY_KEYS, SENTIMENTS } from '@jio/core'
import type { Confidence, EntityKey, Lang, Sentiment, TopicDef } from '@jio/core'

export type { TopicDef }

export const UNCLASSIFIED_SLUG = 'unclassified'
/** The Emerging bucket is filled by clustering (03-03), never by the classifier. */
export const EMERGING_SLUG = 'emerging'

export type ClassifyResult = {
  postId: string
  topicSlug: string
  sentiment: Sentiment
  entities: EntityKey[]
  confidence: Confidence
  glossEn: string | null
}

export type ClassifierInput = { postId: string; text: string; lang: Lang }

export interface Classifier {
  /** Model id (or 'stub-v1') stored on each classifications row. */
  readonly model: string
  /** Bumped whenever the prompt or rules change, so cached labels can be invalidated. */
  readonly promptVersion: string
  /** One result per input item, in input order. */
  classify(items: ClassifierInput[], topics: TopicDef[]): Promise<ClassifyResult[]>
}

/** A gold or corrected label from the dashboard, rendered into the prompt as a worked example. */
export type FewShotExample = {
  text: string
  lang: Lang
  topicSlug: string
  sentiment: Sentiment
  entities: EntityKey[]
}

export const MAX_GLOSS_CHARS = 200

/** Topics the classifier may assign: everything except the Emerging and Unclassified buckets. */
export function classifiableTopics(topics: TopicDef[]): TopicDef[] {
  return topics.filter(
    (t) => t.kind !== 'unclassified' && t.slug !== UNCLASSIFIED_SLUG && t.slug !== EMERGING_SLUG,
  )
}

/** Raw item shape, matching the JSON schema the model answers with (ref is checked by the caller). */
const RawResult = z.object({
  topic: z.string(),
  sentiment: z.enum(SENTIMENTS),
  entities: z.array(z.unknown()),
  confidence: z.enum(CONFIDENCES),
  gloss_en: z.string().nullish(),
})

const ENTITY_SET = new Set<string>(ENTITY_KEYS)

export function lowResult(postId: string): ClassifyResult {
  return {
    postId,
    topicSlug: UNCLASSIFIED_SLUG,
    sentiment: 'neutral',
    entities: [],
    confidence: 'low',
    glossEn: null,
  }
}

export function normalizeResult(
  raw: unknown,
  postId: string,
  validSlugs: Set<string>,
): ClassifyResult {
  const parsed = RawResult.safeParse(raw)
  if (!parsed.success) return lowResult(postId)
  const r = parsed.data

  const entities: EntityKey[] = []
  for (const e of r.entities) {
    if (typeof e === 'string' && ENTITY_SET.has(e) && !entities.includes(e as EntityKey)) {
      entities.push(e as EntityKey)
    }
  }

  const known = r.topic !== UNCLASSIFIED_SLUG && validSlugs.has(r.topic)
  const confident = known && r.confidence === 'high'

  const gloss = (r.gloss_en ?? '').trim().slice(0, MAX_GLOSS_CHARS)

  return {
    postId,
    topicSlug: confident ? r.topic : UNCLASSIFIED_SLUG,
    sentiment: r.sentiment,
    entities,
    confidence: confident ? 'high' : 'low',
    glossEn: gloss === '' ? null : gloss,
  }
}
