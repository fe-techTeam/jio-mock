import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database and truncate it; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
