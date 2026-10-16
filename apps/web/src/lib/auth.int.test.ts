// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import type { Sql } from 'postgres'
import { createAuth } from './auth'
import { SeedUserError, seedUser } from './seed-user'

const SECRET = 'test-secret-test-secret-test-secret-123'
let db: Db
let sql: Sql

beforeAll(async () => {
  const url = await prepareTestDb('jio_ipo_test_web')
  ;({ db, sql } = connectTestDb(url))
})
afterAll(async () => {
  await sql.end({ timeout: 5 })
})
beforeEach(async () => {
  await truncateAll(sql)
})

describe('seedUser', () => {
  const base = () => ({
    db,
    email: 'Strategy@Jio.local',
    password: 'correct-horse-12',
    secret: SECRET,
  })

  it('creates one lowercased user with a hashed credential account', async () => {
    expect(await seedUser(base())).toBe('created')
    const users = await db.select().from(schema.user)
    expect(users).toHaveLength(1)
    expect(users[0]!.email).toBe('strategy@jio.local')
    const accounts = await db.select().from(schema.account)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]!.providerId).toBe('credential')
    expect(accounts[0]!.password).toBeTruthy()
    expect(accounts[0]!.password).not.toBe('correct-horse-12')
  })

  it('updates the password on a rerun and the new password signs in', async () => {
    await seedUser(base())
    expect(await seedUser({ ...base(), password: 'another-horse-34' })).toBe('updated')
    expect(await db.select().from(schema.user)).toHaveLength(1)
    const auth = createAuth({ db, secret: SECRET })
    const ok = await auth.api.signInEmail({
      body: { email: 'strategy@jio.local', password: 'another-horse-34' },
    })
    expect(ok.user.email).toBe('strategy@jio.local')
    await expect(
      auth.api.signInEmail({ body: { email: 'strategy@jio.local', password: 'correct-horse-12' } }),
    ).rejects.toThrow()
  })

  it.each(['', 'short-pw'])('rejects password %j naming SEED_USER_PASSWORD only', async (pw) => {
    const err = await seedUser({ ...base(), password: pw }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SeedUserError)
    expect((err as Error).message).toContain('SEED_USER_PASSWORD')
    expect((err as Error).message).not.toContain('short-pw')
    expect(await db.select().from(schema.user)).toHaveLength(0)
  })
})
