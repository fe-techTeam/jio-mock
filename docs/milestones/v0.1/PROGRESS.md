# v0.1 Progress

Appended after each phase.

## 00-foundation (2026-10-16)

- 00-01: pnpm workspace, TS/lint/format, Postgres container (5433, test DB), CI, README runbook.
- 00-02: Next.js 15 app with shadcn, Vitest, Playwright config, /api/health with DB ping.
- 00-03: @jio/core IST time helpers, @jio/db createDb, @jio/worker boot with pg-boss and contract queues.

Deviations: corepack integrity workaround; hand-written shadcn components.json; no exchange holiday model; pgboss.queue has 7 rows not 6. Playwright browsers not installed (Phase 07).

## 01-data-and-login (2026-10-16)

- 01-01: @jio/core domain constants, adapter/api types, zod AppConfig + DEFAULT_CONFIG, 12 seed topics, Unicode-boundary keyword matcher (117 tests).
- 01-02: full Drizzle schema + auth tables, migrations, query helpers, upserts, db:seed (51 tests).
- 01-03: Better Auth login, lockout after 5 failures, middleware, protected shell, login/view audit events.

Deviations: config schema gained anchor_groups, generic_hashtags, lane and record-valued creds_ref; per-package test DBs; migrate.ts edited for next build. SUMMARY-01-01/02 not written (harness blocked); ROADMAP ticks 01-03 only.
