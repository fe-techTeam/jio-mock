import type { Db } from '@jio/db'
import { createAuth } from './auth'

export class SeedUserError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedUserError'
  }
}

export type SeedUserInput = {
  db: Db
  email: string
  password: string
  name?: string
  secret?: string
}

/** Creates the shared login, or resets its password when the email already exists. */
export async function seedUser(input: SeedUserInput): Promise<'created' | 'updated'> {
  const { db, password, name = 'Strategy team', secret } = input
  const email = input.email.trim().toLowerCase()
  if (password.length < 12) {
    throw new SeedUserError('SEED_USER_PASSWORD must be at least 12 characters: set it in .env')
  }
  if (!email) throw new SeedUserError('SEED_USER_EMAIL is empty: set it in .env')

  const auth = createAuth({ db, allowSignUp: true, secret })
  const ctx = await auth.$context
  const existing = await ctx.internalAdapter.findUserByEmail(email)

  if (!existing) {
    await auth.api.signUpEmail({ body: { email, password, name } })
    return 'created'
  }
  await ctx.internalAdapter.updatePassword(existing.user.id, await ctx.password.hash(password))
  return 'updated'
}
