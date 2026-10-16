// `pnpm db:seed` (first half): config v1 and the seed topics. The login user is created by
// apps/web's `seed:user` script through Better Auth.
import { createDb } from './client'
import { seedBase } from './seed'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('db:seed: DATABASE_URL is not set (copy .env.example to .env at the repo root)')
  process.exit(1)
}

const { db, sql } = createDb(url, { max: 1 })
try {
  const r = await seedBase(db)
  console.log(
    `db:seed: config v${r.configVersion} (${r.configCreated ? 'created' : 'kept'}), ` +
      `${r.topicsInserted} topic(s) inserted`,
  )
} catch (e) {
  console.error('db:seed failed:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
