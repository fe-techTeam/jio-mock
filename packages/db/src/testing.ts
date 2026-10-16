// Test-database harness. Imported as `@jio/db/testing`; production code never imports it.
// Rule: @jio/db tests use `jio_ipo_test`; every other package calls
// `prepareTestDb('jio_ipo_test_<pkg>')` from its own vitest globalSetup, because the root
// `pnpm -r test` runs packages in parallel and truncateAll would clobber a shared database.
import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import postgres, { type Sql } from 'postgres'
import { createDb, type Db } from './client'
import { runMigrations } from './migrate'
import * as schema from './schema'

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  process.env.TEST_DATABASE_URL ??
  'postgres://jio:jio@localhost:5433/jio_ipo_test'

const DB_NAME = /^[a-z0-9_]+$/

function mask(u: URL): string {
  return `${u.hostname}:${u.port || '5432'}`
}

/** TEST_DATABASE_URL's server with another database name (checked against ^[a-z0-9_]+$). */
export function testDatabaseUrl(name: string): string {
  if (!DB_NAME.test(name)) throw new Error(`Invalid test database name: ${name}`)
  const u = new URL(TEST_DATABASE_URL)
  u.pathname = `/${name}`
  return u.toString()
}

/** Creates the test database on the server if it is missing. Safe to call concurrently. */
export async function ensureTestDatabase(url: string): Promise<void> {
  const target = new URL(url)
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''))
  if (!DB_NAME.test(name)) throw new Error(`Invalid test database name: ${name}`)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} })
  try {
    const rows = await sql`select 1 from pg_database where datname = ${name}`
    if (rows.length === 0) await sql`create database ${sql(name)}`
  } catch (e) {
    const err = e as { code?: string; errors?: { code?: string }[] }
    // A concurrent caller created it first.
    if (err.code === '42P04' || err.code === '23505') return
    const refused =
      err.code === 'ECONNREFUSED' || err.errors?.some((x) => x.code === 'ECONNREFUSED')
    if (refused) {
      throw new Error(
        `Test database unreachable at ${mask(target)}: run "pnpm db:up && pnpm db:test-setup"`,
      )
    }
    throw e
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Creates (if needed) and migrates a test database; returns its url. */
export async function prepareTestDb(name = 'jio_ipo_test'): Promise<string> {
  const url = testDatabaseUrl(name)
  await ensureTestDatabase(url)
  await runMigrations(url)
  return url
}

/** A small client for tests; close it with `sql.end()` in afterAll. */
export function connectTestDb(url: string): { db: Db; sql: Sql } {
  return createDb(url, { max: 2 })
}

const ALL_TABLES = (Object.values(schema) as unknown[])
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => getTableName(t))

/** Empties every app and auth table (RESTART IDENTITY CASCADE). */
export async function truncateAll(sql: Sql): Promise<void> {
  await sql.unsafe(
    `truncate table ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
  )
}
