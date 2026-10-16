// Shared by playwright.config.ts and global-setup.ts. Everything points at the isolated
// jio_ipo_e2e database and fixture mode; no key is ever set, so no test reaches a network.
export const E2E_PORT = 3101
export const E2E_DB = 'jio_ipo_e2e'
export const E2E_DB_URL = `postgres://jio:jio@localhost:5433/${E2E_DB}`
export const MAINTENANCE_DB_URL = 'postgres://jio:jio@localhost:5433/jio_ipo'
export const SEED_EMAIL = 'strategy@jio.local'
export const SEED_PASSWORD = 'e2e-Local-Passw0rd'

const BLANK_KEYS = [
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'X_BEARER_TOKEN',
  'APIFY_TOKEN',
  'YOUTUBE_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'SERPER_API_KEY',
]

export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: E2E_DB_URL,
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  BETTER_AUTH_SECRET: 'e2e-test-secret-0123456789abcdef0123456789abcdef',
  // 32 bytes of 0x01, base64
  CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  SOURCES_MODE: 'fixture',
  SEED_USER_EMAIL: SEED_EMAIL,
  SEED_USER_PASSWORD: SEED_PASSWORD,
  COREPACK_INTEGRITY_KEYS: '0',
  ...Object.fromEntries(BLANK_KEYS.map((k) => [k, ''])),
}
