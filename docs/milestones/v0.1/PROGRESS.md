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

## 04-dashboard

- Wave 1: gate green, fix rounds 0
  - 04-01 done: 04-02/04-03: import types from @jio/core (BriefResponse, TimelineResponse, EvidencePage, TopicRow...) and fetch with getBrief/getTimeline/getEvidence and queryKeys from '@/lib/api' (browser-safe). The brief's pos/neu/neg
- Wave 2: gate green, fix rounds 1
  - 04-02 done: Open evidence: useOpenEvidence()({topic, topicName, sentiment, entity, from, to, source, confidence, window?, sort?}); the drawer is already mounted once in (app)/layout.tsx. Reuse: EvidenceCard (evidence/evidence-card.t
- Wave 3: gate green, fix rounds 0
  - 04-03 done: Topic page: apps/web/src/app/(app)/topics/[slug]/page.tsx renders TopicView (apps/web/src/components/topic/topic-view.tsx) under Suspense. 06-01 lane toggle: pass it as children of the FilterBar in topic-view.tsx (curren

## 05-operator-pages

- Wave 1: gate green, fix rounds 0
  - 05-01 done: GET/PATCH /api/sources and GET /api/sources/[key]/runs are session-guarded via withApi; nothing returns credential values (explicit field allowlist in _lib/build.ts). Web crypto: encryptSecret/decryptSecret/isEncrypted/C
  - 05-02 done: Settings API: GET/PATCH /api/config (terms, retentionDays, minItemsForSplit, activeMinItems24h; baseVersion required), POST /api/config/test-terms, GET/PATCH /api/config/topics, GET /api/config/audit?cursor=, POST /api/t
  - 05-03 done: POST /api/labels returns {ok, classificationId}; DELETE /api/labels/[id] undoes correction or gold rows younger than 10 minutes; each call writes exactly one 'relabel' event (undo has detail.undo true). GET /api/accuracy

## 06-trust-layer

- Wave 1: gate green, fix rounds 0
  - 06-01 done: 06-02: the rollup upsert writes counts + reach_* only, so fill the coordination columns separately. TRUST_DEFAULTS.coordination is in apps/worker/src/trust/config.ts; read it with resolveTrustConfig(config).coordination.
- Wave 2: gate green, fix rounds 0
  - 06-02 done: runRollup now returns `coordination: {flagged, refreshedRows}`, and recomputeRange takes an optional `coordination` config. The shared fan CTE is in apps/worker/src/rollup/fan.ts. posts.coord_suspected never resets to fa
