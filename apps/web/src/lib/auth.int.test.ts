// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { schema, type Db } from '@jio/db'
import { connectTestDb, prepareTestDb, truncateAll } from '@jio/db/testing'
import type { Sql } from 'postgres'
import { createAuth } from './auth'
import { createAuthRouteHandlers } from './auth-route'
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

describe('guarded auth route', () => {
  const EMAIL = 'strategy@jio.local'
  const PASSWORD = 'correct-horse-12'
  const BASE = 'http://localhost:3100'
  const T0 = new Date('2026-10-16T10:00:00Z')
  let clock = T0
  const at = (min: number) => new Date(T0.getTime() + min * 60_000)

  function handlers() {
    const auth = createAuth({ db, secret: SECRET, baseURL: BASE })
    return createAuthRouteHandlers({ auth, db, now: () => clock })
  }
  function post(path: string, body: unknown, extra: Record<string, string> = {}) {
    return new Request(`${BASE}/api/auth/${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': '203.0.113.7',
        ...extra,
      },
      body: JSON.stringify(body),
    })
  }
  const signIn = (h: ReturnType<typeof handlers>, password: string, email = EMAIL) =>
    h.POST(post('sign-in/email', { email, password }))
  const events = async (kind: string) =>
    (await db.select().from(schema.eventLog)).filter((e) => e.kind === kind)

  beforeEach(async () => {
    clock = T0
    await seedUser({ db, email: EMAIL, password: PASSWORD, secret: SECRET })
  })

  it('logs a successful sign-in with a session, cookie and login event', async () => {
    const res = await signIn(handlers(), PASSWORD, 'Strategy@Jio.local')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('better-auth.session_token')
    expect(await db.select().from(schema.session)).toHaveLength(1)
    const ev = await events('login')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.actor).toBe(EMAIL)
    expect(ev[0]!.ip).toBe('203.0.113.7')
  })

  it('locks after 5 failures, even for the right password, and unlocks after 15 minutes', async () => {
    const h = handlers()
    for (let i = 0; i < 5; i++) {
      clock = at(i)
      expect((await signIn(h, 'wrong-password-1')).status).toBe(401)
    }
    expect(await events('login_failed')).toHaveLength(5)

    clock = at(4)
    const locked = await signIn(h, PASSWORD)
    expect(locked.status).toBe(429)
    expect(await locked.json()).toEqual({
      code: 'ACCOUNT_LOCKED',
      message: 'Too many failed attempts. Try again in 15 minutes.',
    })
    expect(locked.headers.get('retry-after')).toBeTruthy()
    expect(await events('login_locked')).toHaveLength(1)
    expect(await events('login_failed')).toHaveLength(5)
    expect(await db.select().from(schema.session)).toHaveLength(0)

    clock = at(21)
    expect((await signIn(h, PASSWORD)).status).toBe(200)
    expect(await events('login')).toHaveLength(1)
    // The success resets the count: one more wrong password does not lock.
    clock = at(22)
    expect((await signIn(h, 'wrong-password-1')).status).toBe(401)
    clock = at(23)
    expect((await signIn(h, PASSWORD)).status).toBe(200)
  })

  it('logs a wrong password for an unknown email per email', async () => {
    const res = await signIn(handlers(), 'wrong-password-1', 'Nobody@Jio.local')
    expect(res.status).toBe(401)
    const ev = await events('login_failed')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.actor).toBe('nobody@jio.local')
  })

  it('does not expose sign-up', async () => {
    const res = await handlers().POST(
      post('sign-up/email', { email: 'x@jio.local', name: 'X', password: 'a-long-password-9' }),
    )
    expect(res.status).toBe(404)
    expect(await db.select().from(schema.user)).toHaveLength(1)
  })

  it('signs out with a logout event naming the user', async () => {
    const h = handlers()
    const res = await signIn(h, PASSWORD)
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
    const out = await h.POST(post('sign-out', {}, { cookie }))
    expect(out.status).toBe(200)
    const ev = await events('logout')
    expect(ev).toHaveLength(1)
    expect(ev[0]!.actor).toBe(EMAIL)
  })
})
