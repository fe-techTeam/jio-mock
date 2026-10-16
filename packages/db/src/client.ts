import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres, { type Sql } from 'postgres'
import * as schema from './schema'

export type Db = PostgresJsDatabase<typeof schema>

export function createDb(
  url: string,
  opts?: { max?: number; connectTimeoutSec?: number },
): { db: Db; sql: Sql } {
  const sql = postgres(url, {
    max: opts?.max ?? 10,
    connect_timeout: opts?.connectTimeoutSec ?? 5,
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema })
  return { db, sql }
}

/** Resolves true when `select 1` succeeds within timeoutMs; never throws. */
export async function pingDb(sql: Sql, timeoutMs = 2000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ping timeout')), timeoutMs)
    })
    await Promise.race([sql`select 1`, timeout])
    return true
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}
