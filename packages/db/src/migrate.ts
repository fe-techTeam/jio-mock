import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

// path.resolve (not `new URL('../migrations', ...)`) so webpack in the web app does not try to bundle the folder.
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

/**
 * Applies pending migrations from packages/db/migrations. A session advisory lock serialises
 * concurrent callers (parallel test packages migrating the same database).
 */
export async function runMigrations(url: string): Promise<void> {
  const lock = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} })
  try {
    await lock`select pg_advisory_lock(hashtext('jio_db_migrations'))`
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      await lock`select pg_advisory_unlock(hashtext('jio_db_migrations'))`
    }
  } finally {
    await Promise.all([client.end({ timeout: 5 }), lock.end({ timeout: 5 })])
  }
}
