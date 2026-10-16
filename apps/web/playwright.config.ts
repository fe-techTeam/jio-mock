import { defineConfig, devices } from '@playwright/test'
import { E2E_ENV, E2E_PORT } from './e2e/env'

const baseURL = `http://localhost:${E2E_PORT}`
const STATE = 'e2e/.auth/state.json'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: { baseURL },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'smoke',
      testMatch: /(health|smoke|security|a11y)\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: STATE },
    },
    // Last, so probing the sign-in limit cannot disturb the other runs.
    {
      name: 'rate-limit',
      testMatch: /rate-limit\.spec\.ts/,
      dependencies: ['smoke'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'corepack pnpm build && corepack pnpm exec next start -p ' + E2E_PORT,
    url: `${baseURL}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: E2E_ENV,
  },
})
