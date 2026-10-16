import { getDb } from '../src/lib/db'
import { seedUser } from '../src/lib/seed-user'

const email = process.env.SEED_USER_EMAIL || 'strategy@jio.local'
const password = process.env.SEED_USER_PASSWORD ?? ''

if (!password) {
  console.error('SEED_USER_PASSWORD is empty: set it in .env')
  process.exit(1)
}

const { db, sql } = getDb()
try {
  const result = await seedUser({ db, email, password })
  console.log(`seed user ${email.toLowerCase()}: ${result}`)
} catch (e) {
  console.error(e instanceof Error ? e.message : 'seed user failed')
  process.exitCode = 1
} finally {
  await sql.end({ timeout: 5 })
}
