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

## 02-ingestion (2026-10-16)

- 02-01: scheduler, circuit breaker, never-throwing fetch runner, fetch_run events, 11 fixture adapters, 139 fixture posts, --once mode (146 worker tests).
- 02-02: X API v2 adapter with query builder, Apify runner, X fallback, Instagram and LinkedIn sampled adapters.
- 02-03: news RSS, Serper web search, Reddit OAuth, quota-paced YouTube adapters.
- 02-04: Chittorgarh, InvestorGain, IPOWatch cheerio parsers producing Jio market series and news posts.

Deviations: drizzle-orm added to worker; per-file worker test DBs; 02-01 fixtures.test.ts edited twice for real adapters; repeat fixture runs add 0 market points (page-time dedupe); all live adapters tested only against synthetic responses.

## 03-classification

- Wave 1: gate green, fix rounds 0
  - 03-01 done: 03-03: call triagePosts({db, sql}, {embedder: createEmbedder({apiKey: env.VOYAGE_API_KEY}), terms: config.terms, log}), then classify only posts with lang IS NOT NULL AND matched_terms <> '{}'; content_hash is the classi
  - 03-02 done: 03-03: import createClassifier from './classify/anthropic' and call createClassifier({apiKey: env.ANTHROPIC_API_KEY, model: env.CLASSIFIER_MODEL, terms, getFewShot, onUsage, log}), then classifyInBatches(items, topics, {
- Wave 2: gate green, fix rounds 0
  - 03-03 done: 04-01: topic_stats_15m rows are sparse raw counts (apply the 30-item rule at read time); summary_2line holds two lines separated by '\n'; emerging topics have kind 'emerging' and slugs starting 'emerging-' (exclude the g
