import { expect, test as setup } from '@playwright/test'
import { SEED_EMAIL, SEED_PASSWORD } from './env'

export const STATE = 'e2e/.auth/state.json'

// Signs in once and saves the cookies, which keeps the suite under the 5-per-minute sign-in rule.
setup('sign in as the seed user', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(SEED_EMAIL)
  await page.getByLabel(/password/i).fill(SEED_PASSWORD)
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.context().storageState({ path: STATE })
})
