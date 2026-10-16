// Better Auth server. No 'server-only' import: the tsx seed script imports this module too.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { schema, type Db } from '@jio/db'
import { getDb } from './db'

export type CreateAuthOptions = {
  db: Db
  /** Only the seed script enables sign-up. */
  allowSignUp?: boolean
  secret?: string
  baseURL?: string
}

export function createAuth(opts: CreateAuthOptions) {
  return betterAuth({
    appName: 'Jio IPO sentiment',
    baseURL: opts.baseURL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3100',
    secret: opts.secret ?? process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(opts.db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !opts.allowSignUp,
      minPasswordLength: 12,
      autoSignIn: false,
    },
    // Database sessions, 7 days, refreshed once a day. The cookie cache stays off so every
    // session check hits the database and a sign-out takes effect at once.
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    // Per-IP request limits on top of the 01-03 account lockout (5 failures -> 15 min), which
    // lives on the auth route and stays untouched. X-Forwarded-For is trusted only behind a proxy.
    // Off under Vitest so the lockout integration tests can make many sign-in calls from one address.
    rateLimit: {
      enabled: process.env.NODE_ENV !== 'test',
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 5 } },
    },
    plugins: [nextCookies()],
  })
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined
/** The app's auth, built on first use so importing this module never needs DATABASE_URL. */
function real(): Auth {
  instance ??= createAuth({ db: getDb().db })
  return instance
}
export const auth: Auth = new Proxy({} as Auth, {
  get: (_t, prop) => Reflect.get(real(), prop) as unknown,
  // toNextJsHandler checks `'handler' in auth`
  has: (_t, prop) => Reflect.has(real(), prop),
})
