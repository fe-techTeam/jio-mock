// Request and response shapes for /api/labels. Type-only imports from this file are safe in
// browser code (zod is bundled only where the schemas are used).
import { z } from 'zod'
import { ENTITY_KEYS, SENTIMENTS, type Lang } from '@jio/core'

export const GOLD_TARGET = 200
export const GOLD_LANGS = ['en', 'hinglish', 'hi', 'gu'] as const satisfies readonly Lang[]
/** Per-language target while stratifying (4 x 50 = 200). */
export const GOLD_PER_LANG = 50
export const UNDO_WINDOW_MS = 10 * 60_000
export const MAX_EXCLUDE = 200

export const LabelRequest = z.object({
  postId: z.uuid(),
  origin: z.enum(['correction', 'gold']),
  sentiment: z.enum(SENTIMENTS),
  topicSlug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  entities: z
    .array(z.enum(ENTITY_KEYS))
    .max(4)
    .refine((a) => new Set(a).size === a.length, 'entities must be unique'),
  sarcastic: z.boolean().optional(),
})
export type LabelRequest = z.infer<typeof LabelRequest>

/** `ok` is the contract field; classificationId is additive. */
export type LabelResponse = { ok: true; classificationId: string }

export type GoldProgress = {
  labelled: number
  target: typeof GOLD_TARGET
  byLang: Record<Lang, number>
}

export type QueueItem = {
  postId: string
  text: string
  lang: Lang
  glossEn: string | null
  sourceKey: string
  publishedAt: string
  url: string
}

export type QueueResponse = { item: QueueItem | null; progress: GoldProgress }

export const QueueParams = z.object({
  exclude: z
    .string()
    .max(200 * 37)
    .optional()
    .transform((s) => (s ? s.split(',') : []))
    .pipe(z.array(z.uuid()).max(MAX_EXCLUDE)),
})
