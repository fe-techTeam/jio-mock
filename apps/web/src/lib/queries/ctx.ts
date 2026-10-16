// Read context for the dashboard queries: the shared db handle plus an injected clock.
// Raw aggregates use postgres-js tagged templates (parameters only, never string-built SQL).
// The drizzle postgres-js driver turns off timestamp parsing and serializing on the shared
// client, so timestamps go in as ISO strings with ::timestamptz casts and come out as epoch ms.
import type { Db } from '@jio/db'
import type { Sql } from 'postgres'
import { getDb } from '../db'

export type ReadCtx = { db: Db; sql: Sql; now: Date }

export function readCtx(now: Date = new Date()): ReadCtx {
  const { db, sql } = getDb()
  return { db, sql, now }
}

/** Filters shared by the brief and the timeline. 'all' rows are stored literally in rollups. */
export type SliceFilter = {
  entity: 'all' | 'mukesh' | 'akash' | 'isha' | 'jio'
  lane: 'all' | 'social' | 'media'
}

export const iso = (d: Date) => d.toISOString()

/** An epoch-ms column value (float8 or numeric string) as an ISO string. */
export function msToIso(ms: number | string | null | undefined): string | null {
  if (ms == null) return null
  return new Date(Number(ms)).toISOString()
}

export const minutesBetween = (later: Date, earlier: Date) =>
  Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 60_000))
