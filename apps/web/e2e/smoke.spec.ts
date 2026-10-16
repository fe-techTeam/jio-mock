import { expect, test } from '@playwright/test'
import { SEED_EMAIL, SEED_PASSWORD } from './env'

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('/ redirects to /login, which says access is logged', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Access is logged')).toBeVisible()
  })
})

test('brief, evidence drawer, topic page and sources on the demo board', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Executive brief', includeHidden: true }),
  ).toBeAttached()
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()

  const rows = page.locator('tbody tr')
  await expect.poll(() => rows.count()).toBeGreaterThanOrEqual(3)
  await expect(page.getByText(/Not enough data \(n=/).first()).toBeVisible()
  await expect(page.getByText('Unofficial').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /old/ })).toBeVisible()

  // Evidence drawer from a negative bar segment.
  // The demo board has no negative segment in the topic table (n < 30 or neutral heavy), so use
  // the negative segment of the headline sentiment split.
  const segment = page.getByRole('button', { name: /Negative \d+%, open evidence/ }).first()
  await segment.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading').first()).toContainText('Negative')
  const cards = dialog.locator('article')
  await expect.poll(() => cards.count()).toBeGreaterThanOrEqual(1)
  const links = dialog.getByRole('link', { name: /Open original/ })
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', /noopener/)
  }
  for (const card of await cards.all()) {
    const text = await card.innerText()
    if (/(X|Reddit|YouTube|Web) user/.test(text)) expect(text).not.toMatch(/@\w/)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(segment).toBeFocused()

  // Isha has no active talking points on the demo board, so the entity choice is made on the
  // topic page; going back must keep it.
  await rows.first().getByRole('link').first().click()
  await expect(page).toHaveURL(/\/topics\/[^/?]+/)
  await expect(page.getByRole('img').first()).toBeVisible()
  await page.getByRole('radio', { name: 'Isha' }).click()
  await expect(page).toHaveURL(/entity=isha/)
  await page.getByRole('link', { name: /Back to brief/ }).click()
  await expect(page).toHaveURL(/entity=isha/)
})

test('an unknown topic is a 404 with a link back to the brief', async ({ page }) => {
  // The (app) loading.tsx streams the shell first, so Next answers 200 here; the not-found page
  // itself is what must render.
  await page.goto('/topics/does-not-exist')
  await expect(page.getByRole('heading', { name: 'Topic not found' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Back to the brief' })).toBeVisible()
})

test('sources page lists 11 fixture sources and the Apify fallback', async ({ page }) => {
  await page.goto('/sources')
  await expect(page.getByText('Apify fallback').first()).toBeVisible()
  await expect.poll(() => page.locator('tbody tr').count()).toBe(11)
  await expect(page.getByText('fixture', { exact: true }).first()).toBeVisible()
})

// A separate sign-in: signing out revokes the session, which would break the shared saved state.
test('sign out returns to /login', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const page = await ctx.newPage()
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(SEED_EMAIL)
  await page.getByLabel(/password/i).fill(SEED_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  await ctx.close()
})
