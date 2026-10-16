# v0.1 Progress

Appended after each phase.

## 00-foundation (2026-10-16)

- 00-01: pnpm workspace, TS/lint/format, Postgres container (5433, test DB), CI, README runbook.
- 00-02: Next.js 15 app with shadcn, Vitest, Playwright config, /api/health with DB ping.
- 00-03: @jio/core IST time helpers, @jio/db createDb, @jio/worker boot with pg-boss and contract queues.

Deviations: corepack integrity workaround; hand-written shadcn components.json; no exchange holiday model; pgboss.queue has 7 rows not 6. Playwright browsers not installed (Phase 07).
