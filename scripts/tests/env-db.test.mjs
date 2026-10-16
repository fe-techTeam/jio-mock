import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_TEST',
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'SEED_USER_EMAIL',
  'SEED_USER_PASSWORD',
  'CONFIG_ENCRYPTION_KEY',
  'SOURCES_MODE',
  'ANTHROPIC_API_KEY',
  'CLASSIFIER_MODEL',
  'VOYAGE_API_KEY',
  'X_BEARER_TOKEN',
  'APIFY_TOKEN',
  'YOUTUBE_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'SERPER_API_KEY',
]
const SECRETS = [
  'BETTER_AUTH_SECRET',
  'SEED_USER_PASSWORD',
  'CONFIG_ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'X_BEARER_TOKEN',
  'APIFY_TOKEN',
  'YOUTUBE_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'SERPER_API_KEY',
]

function parseEnv(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = /^([A-Z0-9_]+)=([^#]*)/.exec(line)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

test('.env.example defines exactly the contract keys', () => {
  assert.deepEqual(Object.keys(parseEnv(read('.env.example'))).sort(), [...KEYS].sort())
})

test('.env.example secrets are empty', () => {
  const env = parseEnv(read('.env.example'))
  for (const k of SECRETS) assert.equal(env[k], '', `${k} must be empty`)
})

test('.env.example defaults', () => {
  const env = parseEnv(read('.env.example'))
  assert.match(env.DATABASE_URL, /:5433\//)
  assert.match(env.DATABASE_URL_TEST, /:5433\/jio_ipo_test$/)
  assert.equal(env.SOURCES_MODE, 'auto')
  assert.equal(env.BETTER_AUTH_URL, 'http://localhost:3100')
})

test('docker-compose.yml pins pgvector image and port 5433', () => {
  const dc = read('docker-compose.yml')
  assert.ok(dc.includes('pgvector/pgvector:pg16'))
  assert.ok(dc.includes('"5433:5432"'))
  assert.ok(dc.includes('pg_isready -U jio -d jio_ipo'))
})

test('test database init and script exist', () => {
  assert.match(read('scripts/db-init/01-test-db.sql'), /CREATE DATABASE jio_ipo_test;/)
  assert.match(read('scripts/test-db.sh'), /jio_ipo_test ready/)
})
