---
phase: 07-hardening
plan: 01
subsystem: demo-data-and-ui-states
requires:
  - { phase: 01-data-and-login, provides: "seedBase, upsertPosts, insertMarketPoints, logEvent, test-db harness" }
  - { phase: 02-ingestion, provides: "runFetch with modeOverride, ADAPTERS, fixture adapters" }
  - { phase: 03-classification, provides: "createPipelineDeps, runClassifyBatch, runEmerging, runSummaries, runRollup" }
  - { phase: 06-trust-layer, provides: "reach and coordination columns written by the rollup" }
provides:
  - "@jio/db: resetDemoData, amplifyFixturePosts, spreadFixtureTimestamps, synthesizeMarketHistory, demoSnapshot, DemoSnapshot"
  - "apps/worker/src/demo.ts: runDemo, formatDemoTables, DEMO_COPIES, DEFAULT_SEED; root script pnpm demo (-- --purge, -- --seed=N)"
  - "apps/web/src/components/states: resolveQueryState, QueryView, StaleBanner, ErrorState, EmptyState, NotEnoughData, SkeletonRows, CardSkeletons, ChartSkeleton, TabSkeleton"
  - "app/(app)/loading.tsx and error.tsx"
  - "components/brief/sentiment-colors.ts: SENTIMENT_COLORS, SENTIMENT_CLASSES"
affects: [07-02, web, worker, db]
key_files:
  - packages/db/src/seed-demo.ts
  - apps/worker/src/demo.ts
  - apps/web/src/components/states/
  - apps/web/src/components/brief/sentiment-colors.ts
key_decisions:
  - "copies=4 so the busiest topic passes the 30-item split threshold"
  - "runDemo uses runRollup full7d with injected now; no rollup helper added"
  - "emerging topics keyed by name in the snapshot (slugs hash random ids)"
  - "sentiment colours single-sourced; Tailwind classes spelled in full and test-locked"
---

# Phase 07 Plan 01: Demo board and screen states Summary

`pnpm demo` now fills the board with a deterministic week of fixture data through the real pipeline, every screen uses shared loading, empty, error and stale states with the spec copy, and an accessibility pass fixed labels, contrast and focus.

## What was built

1. Demo helpers in `@jio/db` (`seed-demo.ts`): reset (fixture posts, derived rows, demo market points, rollups of the last 7 days; never event_log or live rows), amplify (variants under synthetic authors plus one coordinated cluster of 6), spread timestamps (exactly 45% in the last 24h, 20% in the prior 24h, the rest days 3-7, variants 3h+ apart, cluster inside 30 min), hourly market history, and a snapshot. 13 integration tests.
2. `apps/worker/src/demo.ts`: fixture fetch for all 11 sources, amplify/spread/market, triage and classification (stub without keys, real with them), emerging, `runRollup` full7d with injected now, summaries, snapshot tables. CLI refuses `NODE_ENV=production`. 3 integration tests with fetch stubbed to throw and keys blank (all sources, active/split/not-enough topics, coordination, idempotence, purge).
3. Shared states module in the web app, applied to brief, topic, evidence drawer, sources, settings tabs, accuracy and the app-level loading/error files. Existing spec copy strings were already present and each is asserted in a test.
4. Accessibility: `SENTIMENT_COLORS` (all six pairs at least 4.5:1, tested), segment labels "Negative: 42 posts (35%), open evidence", Entity/Lane aria-labels, sr-only up/down on trend arrows, chart colours via light/dark theme, visible rename label, skip link to `#main`.

## Verification

- `corepack pnpm lint`: clean. `corepack pnpm typecheck`: clean.
- Tests: core 122, db 64, web 468, worker 600, root scripts 14, all passing.
- `pnpm demo` twice gives identical output (10 topics, top 34 items/24h, 6 suspected coordinated); `pnpm demo -- --purge` exits 0 and leaves no fixture posts.

## Deviations

- Rule 3: `id="main"` added to `<main>` in `apps/web/src/app/(app)/layout.tsx`, and a `pnpm demo` row added to the README script table (the root test requires every root script in the README). Both outside `files_modified`.
- STATE.md and the SUMMARY file are not written by this agent per harness rules.

## Issues deferred

- Root `format:check` reports 20 pre-existing files.
- Demo fetch_run events have no `demo: true` marker and accumulate per run.
- Real Anthropic/Voyage paths are not exercised by the demo test; running `pnpm demo` with keys spends real money.
- No browser/axe check of the new markup yet (07-02).
