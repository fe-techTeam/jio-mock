# v0.1 Roadmap

Goal: a locally running, always-on Jio IPO public-sentiment board. It ingests every named source (fixture mode until keys exist), classifies posts by topic, sentiment and entity, rolls them up every 15 minutes, and serves the executive brief, topic detail, evidence, Sources, Settings and Accuracy screens behind a single login.

Inputs: [design resolutions](../../specs/2026-10-16-jio-ipo-analysis-design.md) (these win), [full design](../../specs/2026-10-16-jio-ipo-analysis-brew.md), [contracts](CONTRACTS.md).

Executed through Workflow scripts. Implementers are Opus 5.5 or Sonnet 5.5 only (the `model` key in each plan's frontmatter). Plans in the same wave own disjoint files.

Path ownership (the `owns` column) is binding for planners and implementers. A plan writes only inside its owned paths, plus its own SUMMARY file and the files that receive updates after every plan (STATE.md, ISSUES.md, DECISIONS.md, PROGRESS.md).

## Phase 00: Foundation

Goal: green tooling and runnable skeletons for web, worker, db and core, with the health route answering.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 00-01 | 1 | sonnet | - | root files (package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.mjs, .prettierrc, .gitignore, .env.example, docker-compose.yml, README.md, .github/**, scripts/**) | pnpm workspace, lint, format, typecheck and test scripts, docker db on port 5433, CI, README, .env.example |
| 00-02 | 2 | sonnet | 00-01 | apps/web/** | create-next-app (15, TS, Tailwind, src, App Router), shadcn init, Vitest and Playwright config, `/api/health` checking the db |
| 00-03 | 2 | sonnet | 00-01 | packages/db/**, packages/core/**, apps/worker/** | @jio/db `createDb` and a connection test, @jio/core skeleton with time helpers (`isIndianMarketHours`) and tests, @jio/worker boot that connects pg-boss and logs ready |

- [x] 00-01  - [x] 00-02  - [x] 00-03

## Phase 01: Data model and single login

Goal: the full schema migrated, seed config and topics loaded, and the seeded user able to sign in to an empty protected shell.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 01-01 | 1 | opus | 00-03 | packages/core/** | domain types, zod config schema, DEFAULT_CONFIG (all seed keyword lists, cadences), seed topics, adapter interfaces, api-types skeleton, keyword matcher (co-occurrence and negative terms, bare 'jio' rule) with tests |
| 01-02 | 2 | opus | 01-01 | packages/db/** | full Drizzle schema plus auth schema, migrations (vector, pgcrypto, effective_classifications view), query helpers (config, events, posts, market) with integration tests, `db:seed` (config v1, topics) |
| 01-03 | 3 | sonnet | 01-02 | apps/web/** | Better Auth (email and password, sign-up off, DB sessions), seed user creation, login page, middleware, lockout after 5 failures, login and view audit events, protected placeholder `/` |

- [x] 01-01  - [x] 01-02  - [x] 01-03

## Phase 02: Ingestion

Goal: every named source flows into `posts` and `market_points` on its own cadence, in fixture mode without keys and live with them, with fetch runs logged for freshness and spend.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 02-01 | 1 | opus | 01-02 | apps/worker/src/{index,scheduler,runner,breaker}.ts, apps/worker/src/adapters/index.ts, apps/worker/src/adapters/_fixture.ts, all 11 adapter stub files (created here only), apps/worker/fixtures/** | scheduler (due logic, market hours), fetch runner with circuit breaker, fixture-mode helper, persistence through @jio/db, fetch_run events with cost, stubbed fixture-only adapters, fixtures for all 11 sources |
| 02-02 | 2 | sonnet | 02-01 | adapters x-api.ts, x-apify.ts, apify-instagram.ts, apify-linkedin.ts (+ their tests) | X API v2 recent search (tier and token from config creds, falls back to x_apify when blank or rate-limited), Apify X, Instagram and LinkedIn actors (sampled), query building from terms |
| 02-03 | 2 | sonnet | 02-01 | adapters youtube.ts, reddit.ts, news-rss.ts, web-search.ts (+ tests) | YouTube search.list and commentThreads within quota, Reddit OAuth search across subreddits, Google News and publisher RSS (Mint, ETMarkets, Moneycontrol, Business Standard, ET, Financial Express), Serper web search (site:instagram.com, site:linkedin.com, Groww, Emkay, Centrum) |
| 02-04 | 2 | sonnet | 02-01 | adapters portal-*.ts (+ tests, HTML fixtures) | Chittorgarh, InvestorGain and IPOWatch parsers (cheerio) producing MarketPoint rows (GMP, subscription by category), plus portal news items as posts when present |

- [x] 02-01  - [x] 02-02  - [x] 02-03  - [x] 02-04

## Phase 03: Classification and rollups

Goal: every ingested post gets a topic, sentiment, entities and confidence, and topic_stats_15m holds the numbers the board reads.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 03-01 | 1 | opus | 02-01 | apps/worker/src/triage/**, apps/worker/src/classify/embedder.ts, classify/voyage.ts, classify/embed-stub.ts | script and language detection (en, hinglish, hi, gu), relevance via the keyword matcher, negative-term drop, content hash, embeddings (Voyage or stub), near-duplicate clustering (cosine >= 0.95) |
| 03-02 | 1 | opus | 02-01 | apps/worker/src/classify/{classifier,anthropic,stub,prompt,batch}.ts | Classifier interface, Anthropic implementation (CLASSIFIER_MODEL, structured JSON, batching, content-hash cache, untrusted-text wrapping, few-shot from corrections), deterministic stub, low confidence goes to unclassified |
| 03-03 | 2 | opus | 03-01, 03-02 | apps/worker/src/pipeline/**, apps/worker/src/rollup/**, apps/worker/src/jobs.ts, apps/worker/src/retention.ts | pg-boss wiring (post-ingest triage, classify-batch, rollup every minute, summaries every 30 min, emerging clustering, nightly retention), TopicStat15m recompute of current and previous buckets for each topic x entity x lane, active-topic rule (10 or more in 24h), two-line summaries |

- [ ] 03-01  - [ ] 03-02  - [ ] 03-03

## Phase 04: Executive dashboard

Goal: the family and strategy team see the one-screen brief and can drill from any number to its evidence and to a topic's 7-day timeline.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 04-01 | 1 | opus | 03-03 | apps/web/src/app/api/{brief,topics,evidence}/**, apps/web/src/lib/queries/**, apps/web/src/lib/api.ts, packages/core/src/api-types.ts | read API routes with session check, zod params, 15s cache, 503 handling, ranking (unique-author-weighted volume x velocity), and the evidence privacy rule |
| 04-02 | 2 | opus | 04-01 | apps/web/src/app/(app)/layout.tsx, apps/web/src/app/(app)/page.tsx, apps/web/src/components/{providers.tsx,shell/**,brief/**,evidence/**} | app shell (header, freshness pill, nav), TanStack Query 30s polling, KPI row, ranked topics with sentiment bars and trend arrows, entity filter, Emerging/Unclassified counts, market strip, evidence drawer (Sheet) opened from any number |
| 04-03 | 3 | sonnet | 04-02 | apps/web/src/app/(app)/topics/**, apps/web/src/components/topic/** | topic detail: 7-day hourly sentiment chart with GMP overlay, by-source and by-entity breakdowns, top posts, back link keeping filters, buckets that open the evidence drawer |

- [ ] 04-01  - [ ] 04-02  - [ ] 04-03

## Phase 05: Operator pages

Goal: operators can see source health and spend, set cadences and the X credentials, edit keywords and topics, and measure label accuracy.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 05-01 | 1 | sonnet | 04-02 | apps/web/src/app/(app)/sources/**, apps/web/src/app/api/sources/**, apps/web/src/components/sources/**, apps/web/src/lib/crypto.ts | Sources page: per-source freshness, health, items, spend, sampled or fixture labels, cadence editing, X tier and token card (encrypted, write-only) |
| 05-02 | 1 | sonnet | 04-02 | apps/web/src/app/(app)/settings/**, apps/web/src/app/api/config/**, apps/web/src/app/api/topics/[slug]/promote/**, apps/web/src/components/settings/** | Settings: keyword, hashtag and entity editing with validation, topic list with Emerging promote and merge, retention days, audit log table, locked 'person-level views: off' row |
| 05-03 | 1 | sonnet | 04-02 | apps/web/src/app/(app)/accuracy/**, apps/web/src/app/api/{labels,accuracy}/**, apps/web/src/components/accuracy/**, apps/web/src/components/evidence/relabel.tsx | Accuracy page: gold-set labelling queue (200 posts), per-language accuracy once 200 are labelled, relabel control in the evidence drawer |

- [ ] 05-01  - [ ] 05-02  - [ ] 05-03

## Phase 06: Trust layer

Goal: noise and manipulation stop reading as public opinion, through reach weighting, a media and social lane toggle, and suspected-coordination flags.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 06-01 | 1 | opus | 05-01, 05-02, 05-03 | apps/worker/src/trust/reach.ts, apps/worker/src/rollup/** (reach columns), apps/web/src/components/brief/lane-toggle.tsx, reach-related query changes in apps/web/src/lib/queries/** | per-source reach_score normalization, reach-weighted sentiment in rollups, a media and social lane toggle on the brief and topic pages |
| 06-02 | 2 | opus | 06-01 | apps/worker/src/trust/coordination.ts, apps/worker/src/rollup/** (coordination columns), apps/web/src/components/{brief,topic}/coordination*.tsx | suspected-coordination counts (near-duplicate clusters with 5 or more authors in 60 min, bursts, top-5 author share), shown as 'suspected' counts that open evidence |

- [ ] 06-01  - [ ] 06-02

## Phase 07: Hardening

Goal: the app holds up on first open: realistic demo data, error, empty and loading states everywhere, accessibility basics, an e2e smoke test and security fixes.

| Plan | Wave | Model | Depends | Owns | Delivers |
|---|---|---|---|---|---|
| 07-01 | 1 | sonnet | 06-02 | apps/worker/src/demo.ts, packages/db/src/seed-demo.ts, root `pnpm demo` script, UI state components across apps/web/src/components/** (loading, empty, error) | `pnpm demo` runs every fixture adapter through triage, classification (stub or real) and rollups to fill a realistic board; audit and complete loading, empty and error states; accessibility pass (labels, focus, contrast) |
| 07-02 | 2 | sonnet | 07-01 | apps/web/e2e/**, apps/web/next.config.ts (security headers), fixes under apps/web/src/lib/** | Playwright smoke test (login, brief, topic, evidence drawer, sources), security headers, rate-limit check, a retention-job test, and a README runbook |

- [ ] 07-01  - [ ] 07-02

## After the milestone (jump-start Phases 7-9)

Full verification gate; code, security and silent-failure reviewers in parallel; fix CRITICAL and HIGH findings; run web and worker locally; final report.
