// Lazy database singleton, cached on globalThis so dev HMR does not open a new pool per reload.
// No 'server-only' import: the tsx seed script imports this module too.
import { createDb, type Db } from '@jio/db'
import type { Sql } from 'postgres'

type Handle = { db: Db; sql: Sql }
const g = globalThis as unknown as { __jioWebDb?: Handle }

export function getDb(): Handle {
  if (!g.__jioWebDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set: add it to the root .env')
    g.__jioWebDb = createDb(url)
  }
  return g.__jioWebDb
}
