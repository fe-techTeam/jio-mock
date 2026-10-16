---
phase: 00-foundation
plan: 03
requires:
  - { phase: 00-foundation, provides: [workspace root, tsconfig.base.json, pnpm-locked.sh, Postgres on 5433] }
provides:
  - "@jio/core/time: isIndianMarketHours(d: Date): boolean; toIstParts(d: Date): IstParts; bucketStart15m(d: Date): Date; hourStartIst(d: Date): Date; formatIst(d: Date): string; consts IST_OFFSET_MS, MARKET_OPEN_MIN_IST=555, MARKET_CLOSE_MIN_IST=930"
  - "@jio/db: createDb(url, opts?: {max?, connectTimeoutSec?}): {db: Db, sql: Sql}; pingDb(sql, timeoutMs=2000): Promise<boolean>; type Db; schema (empty, 01-02 owns tables); drizzle.config.ts; scripts db:generate, db:migrate"
  - "@jio/db/testing: TEST_DATABASE_URL, ensureTestDatabase(url): Promise<void>; packages/db/test/global-setup.ts"
  - "@jio/worker: QUEUES (fetch-source, classify-batch, rollup, summaries, emerging, retention), type QueueName, ensureQueues(boss); startWorker({env, logger, bossSchema?}): Promise<{boss, db, stop()}>; loadWorkerEnv(source?): {databaseUrl, sourcesMode}; createLogger(opts?); scripts dev, start, check"
affects: [01-01, 01-02, 02-01, 02-02, 07-hardening]
key_files:
  - packages/core/src/time.ts
  - packages/db/src/client.ts
  - packages/db/src/testing.ts
  - apps/worker/src/boot.ts
  - apps/worker/src/queues.ts
  - apps/worker/src/env.ts
key_decisions:
  - "Exchange holidays are not modelled: a weekday holiday counts as market hours (alternative: NSE holiday list in config; reason: it only changes portal polling between 10 and 60 minutes; reversible: yes)"
  - "pg-boss v10 is a default export (import PgBoss from 'pg-boss'); named import fails at runtime"
issues_created: []
completed: 2026-10-16
---

# 00-03: Core, db and worker skeletons

**IST time helpers in @jio/core, a postgres-js/drizzle client with ping and test-database bootstrap in @jio/db, and a worker that boots, starts pg-boss, creates the six contract queues and logs "worker ready".**

## Accomplishments

- Time helpers use fixed-offset epoch arithmetic, so results ignore process TZ; the hourly bucket is offset 30 minutes from UTC hours.
- `pingDb` never throws and returns false for an unreachable host within the timeout; `ensureTestDatabase` recreates `jio_ipo_test` when dropped (verified).
- `pnpm --filter @jio/worker check` prints one JSON line with msg "worker ready" and exits 0; with an unreachable DB it logs "database unreachable" and exits 1.

## Task commits

1. Task 1: @jio/core skeleton with IST time helpers - `a326aae` (feat)
2. Task 2: @jio/db client, drizzle config and connection test - see git log (feat)
3. Task 3: @jio/worker boot with pg-boss and contract queues - see git log (feat)
4. Metadata - docs(00-03): complete plan

## Decisions

- Holidays not modelled (see key_decisions). The orchestrator should append it to DECISIONS.md; this plan did not edit it.
- drizzle-orm pinned ^0.45.4 and drizzle-kit ^0.31.11 (the latest at install time).

## Deviations from plan

### Auto-fixed
- **[Rule 1 - bug] pg-boss named import** - found in Task 3; `PgBoss is not a constructor`; fix: default import; verified by: boot.int tests.
- **[Rule 3 - blocker] missing node types in worker** - fix: added @types/node devDependency to worker.

### Deferred to ISSUES.md
- None. Note: the `pgboss.queue` table lists 7 rows, the six contract queues plus pg-boss's internal `__pgboss__send-it`; the plan's "6 rows" is really six contract queues.

## Verification

- Tests: `corepack pnpm test` -> core 12, web 2, db 5, worker 8 passed, 0 failed (plus root node:test scripts)
- Lint, typecheck, format:check: PASS; `install --frozen-lockfile` PASS
- Test schemas (pgboss_test_*) are dropped in afterAll; none remain in jio_ipo_test.

## Next-phase readiness

- 01-02 fills packages/db/src/schema.ts and writes the first migration (vector, pgcrypto); add the `db:seed` script then.
- 01-01 adds zod and the domain model to @jio/core; core has no runtime deps yet.
- 02-01 owns apps/worker/src/index.ts and adds the scheduler on startWorker's `boss`/`db` handle; the pg-boss schema is `pgboss` in jio_ipo.
- The worker test config reuses packages/db/test/global-setup.ts to create the test DB.
