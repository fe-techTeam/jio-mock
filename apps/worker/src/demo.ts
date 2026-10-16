// `pnpm demo`: loads every fixture adapter and runs the real pipeline over it in-process (triage,
// classification, emerging topics, rollups, summaries) so the board shows a realistic, deterministic
// week without any API key. Fixture rows are marked is_fixture; `--purge` removes them again.
// Usage: pnpm demo [-- --purge] [-- --seed=N]
import { pathToFileURL } from 'node:url'
import { SOURCE_KEYS } from '@jio/core'
import {
  amplifyFixturePosts,
  createDb,
  demoSnapshot,
  resetDemoData,
  seedBase,
  spreadFixtureTimestamps,
  synthesizeMarketHistory,
  type Db,
  type DemoSnapshot,
} from '@jio/db'
import { ADAPTERS } from './adapters'
import { createLogger } from './log'
import { createPipelineDeps } from './pipeline/deps'
import { runClassifyBatch } from './pipeline/classify-step'
import { runEmerging } from './pipeline/emerging'
import { runSummaries } from './pipeline/summaries'
import { bucketStart, runRollup } from './rollup'
import { runFetch, type Env } from './runner'
import type { Sql } from './triage/repo'

export const DEFAULT_SEED = 2026
/** Each fixture post plus 3 synthetic-author variants: enough for one topic to pass 30 items/24h. */
export const DEMO_COPIES = 4
const MAX_CLASSIFY_ROUNDS = 50

export interface RunDemoOptions {
  db: Db
  /** The postgres client behind `db` (needed by the pipeline's raw SQL). Defaults to db.$client. */
  sql?: Sql
  now?: Date
  seed?: number
  purge?: boolean
  /** API keys come from here; blank keys select the deterministic stubs. */
  env?: Env
  log?: (line: string) => void
}

/** Plain-text tables: fixture posts per source, then items in the last 24h per topic. */
export function formatDemoTables(snap: DemoSnapshot): string {
  const pad = (rows: string[][]) => {
    const w = rows[0]!.map((_, i) => Math.max(...rows.map((r) => r[i]!.length)))
    return rows.map((r) =>
      r
        .map((c, i) => c.padEnd(w[i]!))
        .join('  ')
        .trimEnd(),
    )
  }
  const sources = pad([
    ['source', 'posts'],
    ...SOURCE_KEYS.map((k) => [k, String(snap.bySource[k])]),
  ])
  const topics = pad([
    ['topic', 'items 24h'],
    ...snap.topics24h.map((t) => [t.slug, String(t.items)]),
  ])
  const extra = `classified ${snap.classified}, not relevant ${snap.unclassified}, suspected coordinated ${snap.suspectedCoordinated}`
  return [...sources, '', ...topics, '', extra].join('\n')
}

export async function runDemo(opts: RunDemoOptions): Promise<DemoSnapshot> {
  const { db, purge = false } = opts
  const h = { db, sql: opts.sql ?? (db as unknown as { $client: Sql }).$client }
  const env: Env = opts.env ?? process.env
  const seed = opts.seed ?? DEFAULT_SEED
  const now = opts.now ?? bucketStart(new Date())
  const log = opts.log ?? ((line: string) => console.log(line))
  const logger = createLogger({ level: 'silent' })

  await seedBase(db)
  const { postsDeleted } = await resetDemoData(db, { now })
  log(`reset: removed ${postsDeleted} fixture posts`)

  if (!purge) {
    for (const key of SOURCE_KEYS) {
      const out = await runFetch(
        { db, adapters: ADAPTERS, env: { ...env, SOURCES_MODE: 'fixture' }, now: () => now },
        key,
        { modeOverride: 'fixture' },
      )
      if (out.status !== 'ok') throw new Error(`fixture fetch failed for ${key}: ${out.error}`)
    }
    await amplifyFixturePosts(db, { seed, copies: DEMO_COPIES, now })
    await spreadFixtureTimestamps(db, { now, seed })
    await synthesizeMarketHistory(db, { now, seed })

    const deps = await createPipelineDeps(h, env, { log: logger })
    for (let round = 0; round < MAX_CLASSIFY_ROUNDS; round++) {
      const r = await runClassifyBatch(h, deps, { now })
      if (r.triage.scanned === 0 && r.pending === 0) break
      if (r.classified === 0 && r.triage.scanned === 0) break
    }
    await runEmerging(h, deps, now)
  }

  // 7 days of 15-minute buckets, coordination detection included.
  const roll = await runRollup(h, now, { mode: 'full7d' })
  log(`rollups: ${roll.buckets} buckets, ${roll.rows} rows`)

  if (!purge) {
    const deps = await createPipelineDeps(h, env, { log: logger })
    await runSummaries(h, deps, now)
  }

  const snap = await demoSnapshot(db, { now })
  log(formatDemoTables(snap))
  return snap
}

function parseArgs(argv: string[]): { purge: boolean; seed?: number } {
  const args = argv.filter((a) => a !== '--')
  const seedArg = args.find((a) => a.startsWith('--seed='))
  const seed = seedArg ? Number(seedArg.slice('--seed='.length)) : undefined
  if (seedArg && !Number.isInteger(seed)) throw new Error(`invalid ${seedArg}`)
  return { purge: args.includes('--purge'), seed }
}

async function cli(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('pnpm demo refuses to run when NODE_ENV=production')
  }
  try {
    process.loadEnvFile(new URL('../../../.env', import.meta.url))
  } catch {
    // no .env: DATABASE_URL must already be set
  }
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const { purge, seed } = parseArgs(process.argv.slice(2))
  const { db, sql } = createDb(url, { connectTimeoutSec: 5 })
  try {
    await runDemo({ db, sql, purge, seed })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

const isEntry =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntry) {
  cli().then(
    () => process.exit(0),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    },
  )
}
