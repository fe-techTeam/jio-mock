import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

test('ci.yml triggers, runner and service', () => {
  const ci = read('.github/workflows/ci.yml')
  assert.match(ci, /^\s*push:/m)
  assert.match(ci, /^\s*pull_request:/m)
  assert.match(ci, /runs-on:\s*ubuntu-latest/)
  assert.match(ci, /pgvector\/pgvector:pg16/)
  assert.match(ci, /5433:5432/)
  assert.match(ci, /pg_isready/)
  assert.match(ci, /DATABASE_URL:/)
  assert.match(ci, /DATABASE_URL_TEST:/)
  assert.match(ci, /SOURCES_MODE:\s*fixture/)
})

test('ci.yml runs the checks in order', () => {
  const ci = read('.github/workflows/ci.yml')
  const order = ['pnpm install --frozen-lockfile', 'pnpm lint', 'pnpm typecheck', 'pnpm test'].map(
    (s) => ci.indexOf(s),
  )
  assert.ok(
    order.every((i) => i >= 0),
    'every step present',
  )
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
  )
})

test('README documents the runbook', () => {
  const readme = read('README.md')
  for (const s of ['5433', '3100', 'corepack enable', 'pnpm db:up', 'pnpm db:test-setup']) {
    assert.ok(readme.includes(s), `README missing ${s}`)
  }
})

test('README lists every root script', () => {
  const readme = read('README.md')
  const scripts = Object.keys(JSON.parse(read('package.json')).scripts)
  for (const s of scripts) assert.ok(readme.includes(`pnpm ${s}`), `README missing pnpm ${s}`)
})
