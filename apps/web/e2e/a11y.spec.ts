import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

async function audit(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual(
    [],
  )
}

test.describe('login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test('/login has no serious violations', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('Access is logged')).toBeVisible()
    await audit(page)
  })
})

test('brief', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()
  await expect.poll(() => page.locator('tbody tr').count()).toBeGreaterThan(0)
  await audit(page)
})

test('topic page', async ({ page }) => {
  await page.goto('/')
  await page.locator('tbody tr').first().getByRole('link').first().click()
  await expect(page).toHaveURL(/\/topics\//)
  await expect(page.getByRole('img').first()).toBeVisible()
  await audit(page)
})

for (const path of ['/sources', '/settings', '/accuracy']) {
  test(path, async ({ page }) => {
    await page.goto(path)
    await expect(page.getByRole('main')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await audit(page)
  })
}
