// Keyset cursors for /api/evidence: base64url JSON of the last row's sort key. A cursor only
// continues the sort it was made for. `t` keeps microseconds so ties on published_at page right.
import { z } from 'zod'
import type { EvidenceSort } from '@jio/core'
import { ParamError } from './errors'

export type ReachCursor = { s: 'reach'; r: number; t: string; id: string }
export type NewestCursor = { s: 'newest'; t: string; id: string }
export type Cursor = ReachCursor | NewestCursor

const MAX_CURSOR = 512
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CursorSchema = z.discriminatedUnion('s', [
  z.strictObject({
    s: z.literal('reach'),
    r: z.number().finite(),
    t: z.string().regex(TS),
    id: z.string().regex(UUID),
  }),
  z.strictObject({ s: z.literal('newest'), t: z.string().regex(TS), id: z.string().regex(UUID) }),
])

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')
}

function invalid(message: string): ParamError {
  return new ParamError([{ path: ['cursor'], code: 'invalid_cursor', message }])
}

/** Throws ParamError on anything that is not a cursor for `sort`. */
export function decodeCursor(str: string, sort: EvidenceSort): Cursor {
  if (str.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(str)) throw invalid('Invalid cursor')
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(str, 'base64url').toString('utf8'))
  } catch {
    throw invalid('Invalid cursor')
  }
  const parsed = CursorSchema.safeParse(raw)
  if (!parsed.success) throw invalid('Invalid cursor')
  if (parsed.data.s !== sort) throw invalid(`Cursor was made for sort=${parsed.data.s}`)
  return parsed.data
}
