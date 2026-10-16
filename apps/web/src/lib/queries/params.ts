// Query-param schemas for the read routes (zod 4). Empty strings count as missing.
import { z } from 'zod'
import {
  ENTITY_KEYS,
  EVIDENCE_SORTS,
  EVIDENCE_WINDOWS,
  LANES,
  SENTIMENTS,
  SOURCE_KEYS,
} from '@jio/core'
import { decodeCursor } from './cursor'
import { ParamError } from './errors'

export { ParamError, type ParamIssue } from './errors'

const MAX_SPAN_MS = 7 * 24 * 60 * 60_000
export const SLUG_RE = /^[a-z0-9-]{1,64}$/

const blank = (v: unknown) => (v === '' ? undefined : v)
const q = <T extends z.ZodType>(s: T) => z.preprocess(blank, s)
const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s))

export const BriefParams = z.object({
  entity: q(z.enum(['all', ...ENTITY_KEYS]).default('all')),
  lane: q(z.enum(['all', ...LANES]).default('all')),
})
export type BriefParams = z.output<typeof BriefParams>

export const TimelineParams = BriefParams
export type TimelineParams = BriefParams

export const EvidenceParams = BriefParams.extend({
  topic: q(z.string().regex(SLUG_RE).optional()),
  sentiment: q(z.enum(SENTIMENTS).optional()),
  window: q(z.enum(EVIDENCE_WINDOWS).default('24h')),
  from: q(isoDate.optional()),
  to: q(isoDate.optional()),
  source: q(z.enum(SOURCE_KEYS).optional()),
  confidence: q(z.literal('low').optional()),
  sort: q(z.enum(EVIDENCE_SORTS).default('reach')),
  cursor: q(z.string().max(512).optional()),
  limit: q(z.coerce.number().int().min(1).max(50).default(20)),
}).superRefine((p, ctx) => {
  if ((p.from === undefined) !== (p.to === undefined)) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from and to go together' })
  } else if (p.from && p.to) {
    if (p.to <= p.from)
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' })
    else if (p.to.getTime() - p.from.getTime() > MAX_SPAN_MS) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'span is at most 7 days' })
    }
  }
  if (p.cursor !== undefined) {
    try {
      decodeCursor(p.cursor, p.sort)
    } catch (e) {
      ctx.addIssue({ code: 'custom', path: ['cursor'], message: (e as Error).message })
    }
  }
})
export type EvidenceParams = z.output<typeof EvidenceParams>

/** Parses the first value of each key; throws ParamError with the zod issues. */
export function parseParams<S extends z.ZodType>(schema: S, sp: URLSearchParams): z.output<S> {
  const raw: Record<string, string> = {}
  for (const [k, v] of sp) if (!(k in raw)) raw[k] = v
  const res = schema.safeParse(raw)
  if (!res.success) {
    throw new ParamError(
      res.error.issues.map((i) => ({
        path: i.path.filter((p): p is string | number => typeof p !== 'symbol'),
        code: i.code,
        message: i.message,
      })),
    )
  }
  return res.data
}
