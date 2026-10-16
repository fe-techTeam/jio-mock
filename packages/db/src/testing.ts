import postgres from 'postgres'

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  process.env.TEST_DATABASE_URL ??
  'postgres://jio:jio@localhost:5433/jio_ipo_test'

function mask(u: URL): string {
  return `${u.hostname}:${u.port || '5432'}`
}

/** Creates the test database on the server if it is missing. */
export async function ensureTestDatabase(url: string): Promise<void> {
  const target = new URL(url)
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''))
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid test database name: ${name}`)
  const admin = new URL(url)
  admin.pathname = '/postgres'
  const sql = postgres(admin.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} })
  try {
    const rows = await sql`select 1 from pg_database where datname = ${name}`
    if (rows.length === 0) await sql`create database ${sql(name)}`
  } catch (e) {
    const err = e as { code?: string; errors?: { code?: string }[] }
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
