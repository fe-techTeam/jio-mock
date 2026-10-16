import { expect, test } from '@playwright/test'
import { SEED_EMAIL, SEED_PASSWORD } from './env'

test.use({ storageState: { cookies: [], origins: [] } })

test('repeated bad sign-ins from one address are limited, and the seed user still gets in', async ({
  request,
  baseURL,
}) => {
  const statuses: number[] = []
  for (let i = 0; i < 6; i++) {
    const res = await request.post('/api/auth/sign-in/email', {
      headers: { 'x-forwarded-for': '203.0.113.7', origin: baseURL! },
      data: { email: 'probe@jio.local', password: 'wrong-password-123' },
    })
    statuses.push(res.status())
  }
  expect(statuses.at(-1)).toBe(429)
  expect(statuses.slice(0, 3)).not.toContain(429)

  const ok = await request.post('/api/auth/sign-in/email', {
    headers: { origin: baseURL! },
    data: { email: SEED_EMAIL, password: SEED_PASSWORD },
  })
  expect(ok.status()).toBe(200)
})
