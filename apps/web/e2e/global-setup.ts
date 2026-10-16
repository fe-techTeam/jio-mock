import { spawnSync } from 'node:child_process'
import path from 'node:path'
import postgres from 'postgres'
import { E2E_DB, E2E_ENV, MAINTENANCE_DB_URL } from './env'

const ROOT = path.resolve(process.cwd(), '../..')

function run(args: string[]) {
  const r = spawnSync('corepack', ['pnpm', ...args], {
    cwd: ROOT,
    env: { ...process.env, ...E2E_ENV },
    stdio: 'inherit',
  })
  if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed (${r.status})`)
}

export default async function globalSetup() {
  // Recreate the database so every run starts clean. The dev database jio_ipo is only used as
  // the maintenance connection and is never written to.
  const admin = postgres(MAINTENANCE_DB_URL, { max: 1, onnotice: () => {} })
  try {
    await admin.unsafe(`drop database if exists ${E2E_DB} with (force)`)
    await admin.unsafe(`create database ${E2E_DB}`)
  } finally {
    await admin.end({ timeout: 5 })
  }
  run(['db:migrate'])
  run(['db:seed'])
  run(['demo'])
}
