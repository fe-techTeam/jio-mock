// Accuracy from gold rows compared with model rows. Correction rows are never scored: they are
// operator relabels used only as few-shot examples, so they are counted elsewhere (route.ts).
import { SENTIMENTS, type EntityKey, type Lang, type Sentiment } from '@jio/core'

export type LabelFields = { sentiment: Sentiment; topicSlug: string; entities: EntityKey[] }

export type AccuracyRow = {
  postId: string
  lang: Lang
  gold: LabelFields
  model: (LabelFields & { promptVersion: string | null }) | null
  sarcastic: boolean
}

export type LangAccuracy = { n: number; sentiment: number; topic: number }

export type AccuracyResponse = {
  labelled: number
  target: number
  measured: boolean
  /** Gold posts without a comparable model row. */
  unscored: number
  overall: { sentiment: number; topic: number; entitiesExact: number } | null
  byLang: Record<Lang, LangAccuracy | null>
  /** [gold][model] in the order negative, neutral, positive. */
  confusion: number[][] | null
  sarcasm: { n: number; sentiment: number } | null
  promptVersion: string | null
  promptAt: string | null
  corrections: { count: number; usedAsFewShot: number }
}

export type ComputeOpts = { target: number; promptVersion?: string }
export type Computed = Omit<AccuracyResponse, 'promptVersion' | 'promptAt' | 'corrections'>

export const CONFUSION_ORDER: readonly Sentiment[] = ['negative', 'neutral', 'positive']
const LANG_KEYS: Lang[] = ['en', 'hinglish', 'hi', 'gu', 'other']

const round3 = (x: number) => Math.round(x * 1000) / 1000
const frac = (hits: number, n: number) => round3(hits / n)

function sameEntities(a: EntityKey[], b: EntityKey[]): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  return sa.size === sb.size && [...sa].every((e) => sb.has(e))
}

export function computeAccuracy(rows: AccuracyRow[], opts: ComputeOpts): Computed {
  const labelled = rows.length
  const measured = labelled >= opts.target
  const comparable = rows.filter(
    (r) =>
      r.model !== null &&
      (opts.promptVersion === undefined || r.model.promptVersion === opts.promptVersion),
  ) as (AccuracyRow & { model: NonNullable<AccuracyRow['model']> })[]
  const unscored = labelled - comparable.length

  const byLang = Object.fromEntries(LANG_KEYS.map((l) => [l, null])) as Record<
    Lang,
    LangAccuracy | null
  >
  if (!measured) {
    return {
      labelled,
      target: opts.target,
      measured,
      unscored,
      overall: null,
      byLang,
      confusion: null,
      sarcasm: null,
    }
  }

  const sentOk = (r: (typeof comparable)[number]) => r.gold.sentiment === r.model.sentiment
  const topicOk = (r: (typeof comparable)[number]) => r.gold.topicSlug === r.model.topicSlug
  const n = comparable.length

  const overall =
    n === 0
      ? null
      : {
          sentiment: frac(comparable.filter(sentOk).length, n),
          topic: frac(comparable.filter(topicOk).length, n),
          entitiesExact: frac(
            comparable.filter((r) => sameEntities(r.gold.entities, r.model.entities)).length,
            n,
          ),
        }

  for (const lang of LANG_KEYS) {
    const sub = comparable.filter((r) => r.lang === lang)
    if (sub.length > 0) {
      byLang[lang] = {
        n: sub.length,
        sentiment: frac(sub.filter(sentOk).length, sub.length),
        topic: frac(sub.filter(topicOk).length, sub.length),
      }
    }
  }

  let confusion: number[][] | null = null
  if (n > 0) {
    confusion = SENTIMENTS.map(() => [0, 0, 0])
    for (const r of comparable) {
      confusion[CONFUSION_ORDER.indexOf(r.gold.sentiment)]![
        CONFUSION_ORDER.indexOf(r.model.sentiment)
      ]!++
    }
  }

  const sarc = comparable.filter((r) => r.sarcastic)
  const sarcasm =
    sarc.length === 0
      ? null
      : { n: sarc.length, sentiment: frac(sarc.filter(sentOk).length, sarc.length) }

  return { labelled, target: opts.target, measured, unscored, overall, byLang, confusion, sarcasm }
}
