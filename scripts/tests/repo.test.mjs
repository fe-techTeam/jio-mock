import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('package.json root fields', () => {
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.packageManager, 'pnpm@9.15.4')
  assert.equal(pkg.engines.node, '>=22')
})

test('package.json has required scripts', () => {
  for (const s of [
    'lint',
    'typecheck',
    'test',
    'build',
    'format',
    'format:check',
    'db:up',
    'db:migrate',
    'db:seed',
    'db:test-setup',
    'dev',
  ]) {
    assert.ok(pkg.scripts[s], `missing script ${s}`)
  }
})

test('pnpm-workspace.yaml lists apps and packages', () => {
  const ws = read('pnpm-workspace.yaml')
  assert.match(ws, /apps\/\*/)
  assert.match(ws, /packages\/\*/)
})

test('tsconfig.base.json is strict', () => {
  const ts = JSON.parse(read('tsconfig.base.json')).compilerOptions
  assert.equal(ts.strict, true)
  assert.equal(ts.noUncheckedIndexedAccess, true)
  assert.equal(ts.moduleResolution, 'Bundler')
})

test('.gitignore ignores .env but not .env.example', () => {
  const lines = read('.gitignore')
    .split('\n')
    .map((l) => l.trim())
  assert.ok(lines.includes('.env'))
  assert.ok(lines.includes('!.env.example'))
  assert.ok(lines.includes('.pnpm-exec.lock'))
})
