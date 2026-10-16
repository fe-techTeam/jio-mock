import { expect, request as pwRequest, test } from '@playwright/test'

test('responses carry the security headers and hide X-Powered-By', async ({ request }) => {
  const res = await request.get('/')
  const h = res.headers()
  const csp = h['content-security-policy'] ?? ''
  expect(csp).toContain("default-src 'self'")
  expect(csp).not.toContain('unsafe-eval')
  expect(h['x-frame-options']).toBe('DENY')
  expect(h['x-content-type-options']).toBe('nosniff')
  expect(h['referrer-policy']).toBe('no-referrer')
  expect(h['x-powered-by']).toBeUndefined()
})

test('every read API answers 401 without a session', async ({ baseURL }) => {
  const anon = await pwRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  for (const p of [
    '/api/brief',
    '/api/evidence',
    '/api/topics/gmp-grey-market/timeline',
    '/api/sources',
    '/api/config',
    '/api/accuracy',
  ]) {
    const res = await anon.get(p)
    expect(res.status(), p).toBe(401)
  }
  await anon.dispose()
})

test('a saved X token is never echoed back', async ({ request }) => {
  const token = 'e2e-secret-token-123'
  const get = await request.get('/api/sources')
  expect(get.status()).toBe(200)
  const { configVersion } = (await get.json()) as { configVersion: number }
  const patch = await request.patch('/api/sources', {
    headers: { origin: 'http://localhost:3101' },
    data: { baseVersion: configVersion, x: { bearerToken: token } },
  })
  const patchText = await patch.text()
  expect(patch.status(), patchText).toBe(200)
  expect(patchText).not.toContain(token)
  const after = await (await request.get('/api/sources')).text()
  expect(after).not.toContain(token)
  expect(after).toContain('"credsSet":true')
})
