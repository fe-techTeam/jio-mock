import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

test('GET /api/health reports ok with the database up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true, db: 'up' })
})

test('GET / without a session redirects to /login', async ({ request }) => {
  const res = await request.get('/', { maxRedirects: 0 })
  expect(res.status()).toBe(307)
  expect(res.headers()['location']).toContain('/login')
})
