import { expect, test } from '@playwright/test'

test('GET /api/health reports ok with the database up', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true, db: 'up' })
})

test('GET / serves the placeholder page', async ({ request }) => {
  const res = await request.get('/')
  expect(res.status()).toBe(200)
  expect(await res.text()).toContain('Jio IPO sentiment board')
})
