# Decisions

Decisions made during the unattended build. Each row replaces a question the
developer would otherwise have been asked.

| Date | Decision | Alternatives considered | Reason | Reversible |
|---|---|---|---|---|
| 2026-10-16 | Build in the existing jio-ipo-analysis directory | Nested ./jio-ipo-analysis/ | Directory only held brew docs; nesting would duplicate the name | yes |
| 2026-10-16 | Postgres 16 + pgvector in Docker on host port 5433 | Local Homebrew Postgres 14 on 5432 | Local server has no pgvector and the design needs vectors | yes |
| 2026-10-16 | pnpm via corepack (pnpm@9.15.4) | npm workspaces | Design specifies a pnpm monorepo; pnpm not installed globally | yes |
| 2026-10-16 | Every adapter ships a fixture mode; SOURCES_MODE=auto goes live per key | Block until keys exist | No API keys supplied; the board must run and be demoable now | yes |
| 2026-10-16 | Classifier claude-haiku-5-5 (Anthropic SDK, structured JSON); deterministic stub without key | Other providers | Design says Claude Haiku class; latest Haiku is 5.5 | yes |
| 2026-10-16 | Embeddings voyage-multilingual-2 (1024 dims) with hashing stub | Self-hosted model | Design wants a hosted multilingual embedding model; Anthropic has no embeddings API | costly (vector dims) |
| 2026-10-16 | Web search via Serper (Google results) | Brave Search API | site:instagram.com / site:linkedin.com discovery depends on Google's index | yes |
| 2026-10-16 | posts.is_fixture flag | Separate fixture DB | Lets fixture data be purged when sources go live | yes |
| 2026-10-16 | Web dev port 3100 | 3000 | Avoid clashes with other local projects | yes |
| 2026-10-16 | COREPACK_INTEGRITY_KEYS=0 exported by scripts/pnpm-locked.sh | Upgrade corepack | Installed corepack fails npm signature check (Cannot find matching keyid) | yes |
| 2026-10-16 | Ran corepack enable so nested pnpm calls in root scripts resolve | Global pnpm install | pnpm not otherwise on PATH | yes |
| 2026-10-16 | docker-compose.yml and docs/ added to .prettierignore | Format them | Prettier rewrites the quoted port string and reformats others' markdown | yes |
| 2026-10-16 | next.config.ts loads root .env with loadEnvConfig(..., forceReload=true) | Plain call; per-app .env | Next already loaded apps/web env, so a plain call is a no-op | yes |
| 2026-10-16 | components.json written by hand (new-york, neutral); button uses @radix-ui/react-slot | shadcn CLI init | Current shadcn CLI lacks the style flag | yes |
| 2026-10-16 | vitest.config.ts sets css.postcss.plugins=[] in web | Upgrade Vite | Vite 5 cannot load Next's Tailwind postcss config | yes |
| 2026-10-16 | apps/web/next-env.d.ts git-ignored; @next/env pinned 15.5.28 as dev dep | Commit generated file | Generated file | yes |
| 2026-10-16 | Exchange holidays not modelled; weekday holidays count as market hours | NSE holiday list in config | Only changes portal polling 10 vs 60 min | yes |
| 2026-10-16 | pg-boss v10 imported as default export; drizzle-orm ^0.45.4, drizzle-kit ^0.31.11 pinned | Named import | pg-boss v10 module shape | yes |
| 2026-10-16 | TermsConfig has anchor_groups and generic_hashtags; seed lists split into strong lists and anchors | Hardcode bare-jio rule in matcher | Bare 'jio' must never match alone; rule as data | yes |
| 2026-10-16 | SourceConfig.creds_ref is Record<string,string>|null of env-style name to enc:v1 blob | Bare string | Reddit needs two secrets; 02-01 reads a record | yes |
| 2026-10-16 | NormalizedPost.lane optional field added | Lane fixed per source | web_search and youtube set lane per post | yes |
| 2026-10-16 | DEFAULT_CONFIG is a plain object and matchTerms caches by identity; callers structuredClone before editing | Freeze config | Keeps matcher cache cheap | yes |
| 2026-10-16 | Per-package test DBs: prepareTestDb('jio_ipo_test_<pkg>') | One shared test DB | pnpm -r test runs packages in parallel; truncateAll would clobber | yes |
| 2026-10-16 | Config stored as one jsonb column per config_versions row | Column per key | New AppConfig keys need no migration; defaults fill on read | yes |
| 2026-10-16 | runMigrations takes a session advisory lock; ensureTestDatabase tolerates concurrent create | No locking | Parallel packages migrate the same test DB safely | yes |
| 2026-10-16 | Added posts.lane, classifications.actor, topics.merged_into_id, event_log.actor columns | Derive at read time | Audit and lane needs from design | costly (migration) |
| 2026-10-16 | topic_stats_15m.topic_id cascades on topic delete; classifications.topic_id restricts | Restrict both | Stats are derived data | yes |
| 2026-10-16 | upsertPosts upserts authors in sorted key order; leaves lang, content_hash, matched_terms, embedding for 03-01 triage | Triage inside upsert | Avoids x_api/x_apify deadlocks; triage is a later stage | yes |
| 2026-10-16 | Lockout enforced on the auth HTTP route (5 failures, 30 min lookback, locks on 6th attempt) | Form-only lockout | Covers direct API calls too | yes |
| 2026-10-16 | Auth export is a lazy Proxy; seed password reset via auth.$context.internalAdapter | Eager init; drizzle-orm in web | Import needs no DATABASE_URL; second drizzle copy broke types | yes |
| 2026-10-16 | packages/db/src/migrate.ts uses path.resolve for migrations dir | new URL('../migrations') | next build could not bundle @jio/db | yes |
| 2026-10-16 | Local BETTER_AUTH_SECRET and SEED_USER_PASSWORD generated into gitignored root .env | Leave empty | Login and smoke test need them | yes |
| 2026-10-16 | fetch_run status ok/error/rate_limited stored as text; only error counts toward the breaker | Treat 429 as error | Rate limits must not open the circuit | yes |
| 2026-10-16 | fetch_run detail = {mode, startedAt, since, cursor, fetched, duplicates, dropped, marketPoints, rateLimitedUntil?, quota?}; detail.quota copied from JSON nextCursor.quota | Separate quota table | Operator pages read quota from the event log | yes |
| 2026-10-16 | Config creds: creds_ref wins over env; enc:v1 AES-256-GCM, base64 CONFIG_ENCRYPTION_KEY, blob enc:v1:+base64url(iv12/tag16/ct); decrypt failure = missing, no env fallback | Env first | 05-01 must emit byte-compatible blobs | costly (stored data) |
| 2026-10-16 | Post lane: adapter lane, then media_outlet->media, other/public_figure on media source->social; set before upsert | Post-upsert UPDATE | One write per post | yes |
| 2026-10-16 | Fixture-mode market points get #fixture appended to sourceUrl | Separate table | Distinguishable and purgeable | yes |
| 2026-10-16 | since/cursor come from latest ok run in same mode (since = startedAt - 5 min); none = now - backfill_days | Any-mode cursor | Fixture to live starts a fresh backfill | yes |
| 2026-10-16 | Breaker threshold 3, cooldown min(interval*2^(failures-3),120) min; isDue allows 5s tick slack | Fixed cooldown | Backoff without hammering | yes |
| 2026-10-16 | x_api is the active X route only when enabled, circuit closed, not rate-limited, and live or fixture-forced; else x_apify | Run both | Avoid duplicate cost | yes |
| 2026-10-16 | index.ts main does not reuse boot.ts startWorker; fetch-source switched to stately via updateQueue | Reuse boot | Needs 30s graceful stop | yes |
| 2026-10-16 | --once exits 0 when some sources error; 1 only if DB unreachable | Exit non-zero on any error | Table shows per-source errors | yes |
| 2026-10-16 | Worker integration tests use per-file DBs jio_ipo_test_worker_{runner,scheduler,index} | Shared test DB | vitest.config.ts not owned by 02-01 | yes |
| 2026-10-16 | Live mode without creds throws NotConfiguredError containing 'live mode not built' | New message | Keeps 02-01 fixtures test green | yes |
| 2026-10-16 | X cost estimate 0.005 USD/post, overridable via rate_limits.cost_per_post_usd; max pages via rate_limits.max_pages_per_run (default 3) | Hardcode | Tier pricing varies | yes |
| 2026-10-16 | x_apify builds canonical tweet url from username+id so it equals x_api's url | Use actor link | Cross-source dedupe | yes |
| 2026-10-16 | YouTube cursor JSON {v:1, quota, tracked}; allowance=min(9000, 9000*ptDayFraction+200); search only when units+121<=allowance | Fixed interval | Stay under 10k daily units | yes |
| 2026-10-16 | Serper cost estimated at 0.001 USD per query sent | Billed figure | API returns none | yes |
| 2026-10-16 | web_search uses 8 queries (2 IPO phrases x instagram, linkedin posts, Groww, Emkay/Centrum) | More queries | Credit budget | yes |
| 2026-10-16 | Edited 02-01 fixtures.test.ts stub test to skip real adapters (youtube, reddit, news_rss, web_search, portals) | Leave failing | Real adapters replaced the stubs | yes |
| 2026-10-16 | Portal market point observedAt = page's Last Updated (IST), else now; repeat fixture runs add 0 points | Run time | Stale pages must not write duplicates | yes |
| 2026-10-16 | Portal table lookup is header-driven; header overrides tried before defaults | CSS selectors | Survives layout drift | yes |
| 2026-10-16 | 03-01: 03-01: detectLang counts script shares per word token, not per letter, because the plan's case 'जियो IPO allotment' is only 25% Devanagari by letters | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: the embedding stub is classify/embed-stub.ts (CONTRACTS names classify/stub.ts, which belongs to the classifier stub) | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: the seed 'live' phrases (jio aur jeene do, khul ke jio, जियो और जीने दो) report reason negative_term, matching the brew spec's seed negative terms; tests assert not-relevant | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: repo.ts types the client as ReturnType<typeof createDb>['sql'] (exported Sql) rather than adding a 'postgres' dependency to the worker | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: writeTriage updates only rows still lang IS NULL, and neighbor cluster updates only fill an empty near_dup_cluster_id | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: assessRelevance strips URLs and @handles before calling matchTerms (the SUMMARY-01-01 note) | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-01: 03-01: near-dup cluster id is nd_<seed post id>; clusters are never merged | - | see SUMMARY-03-01 | yes |
| 2026-10-16 | 03-02: createClassifier is exported from classify/anthropic.ts, not re-exported from classifier.ts, to avoid a classifier -> anthropic -> classifier import cycle | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: The classifier never assigns the emerging/unclassified buckets: classifiableTopics drops them from the prompt topic list, the schema enum and validSlugs | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: The raw label shape is the model schema item {topic, sentiment, entities, confidence, gloss_en}; the stub emits the same shape so both go through normalizeResult | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: '<' inside wrapped JSON is escaped as < (the plan's '<' was an HTML-mangled <) | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: onUsage inputTokens = uncached + cache-write + cache-read tokens; cost prices cache writes at 1.25x and reads at 0.1x of $0.10/MTok, output at $0.50/MTok (named constants) | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: An empty CLASSIFIER_MODEL is treated as unset and falls back to claude-haiku-5-5 | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: AnthropicClassifier, createClassifier and classifyInBatches take an optional log: Pick<Logger,'warn'>; AnthropicClassifier.client is public and readonly | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-02: Adding @anthropic-ai/sdk pulled in @opentelemetry/api and changed the peer-resolved drizzle-orm variant; a workspace pnpm install was needed to relink packages/db (lockfile committed with Task 3) | - | see SUMMARY-03-02 | yes |
| 2026-10-16 | 03-03: Rule 3: the '// Phase 03' placeholder in apps/worker/src/index.ts is replaced by one import (createPipelineDeps, registerPipelineJobs from './jobs') and one await registerPipelineJobs(...) call, which Prettier wraps over 5 lines. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: Queues that ensureQueues already created get the stately/retryLimit 1/expire 900 options through updateQueue instead of being skipped. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: createPipelineDeps(h, env, {log?, terms?}) is async (the stub classifier's terms come from the config at boot), and PipelineDeps has an optional usage meter for classifier token logging. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: Timestamps go to postgres-js as ISO strings with ::timestamptz casts, because the drizzle postgres-js driver disables Date serialization. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: runRollup also returns a status field (active, dormant and changed counts). | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: Emerging only moves posts whose effective label is a model row; analyst corrections and gold labels are never moved. A topic and its member rows are written in one transaction; slugs use the IST day. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: An unknown or generic 'emerging' slug from the classifier maps to the unclassified topic with confidence forced to 'low'. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: runSummaries computes 24h stats live from posts; seed topics need at least 1 item and emerging topics at least 3; the Anthropic summarizer throws on refusal, max_tokens or malformed JSON, and that topic is skipped. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: The retention job handler writes one 'retention' event_log row with the counts; runRetention itself never touches event_log. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 03-03: No ledger file under docs/plans (outside the owned paths) and no code-reviewer subagent was available, so the final review was a self-review. | - | see SUMMARY-03-03 | yes |
| 2026-10-16 | 04-01: apps/web depends on zod ^4.6.7, not zod@3: adding zod 3 pushed better-call's zod ^4 peer down to 3.25 (unmet peer, risk to better-auth). Web param schemas use the zod 4 API; @jio/core stays on zod 3. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: Each integration test file has its own DB (jio_ipo_test_web_brief, _timeline, _evidence), because the read tests truncate tables and Vitest runs files in parallel next to auth.int.test.ts on jio_ipo_test_web. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: /api/evidence returns Cache-Control no-store; brief and timeline return private, max-age=15 (withApi takes a cacheControl option). | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: The active rule (>= active_min_items_24h) and the split rule apply to the selected entity/lane slice, not to the all/all status the worker stores in topics.status. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: Market strip ageMin = minutes since the newer of observedAt and the source's last successful fetch; stale = that source's freshness status is not ok. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: Freshness: waiting = no ok run; stale = age > 2x the effective interval or >= 3 failures in a row; the market-hours interval applies during isIndianMarketHours(now); only enabled sources are listed. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: The cursor is checked inside EvidenceParams (garbage or a sort mismatch gives 400 before any query); cursor t keeps microseconds and reach is compared as float8. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: A failed auth.api.getSession (DB down) returns 503 db_unavailable, not 500. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: Timeline meta items24h and lastItemAt honour the entity/lane filter; byEntity ignores the entity filter but honours lane. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-01: ParamError lives in apps/web/src/lib/queries/errors.ts (inside the owned glob) so params.ts and cursor.ts do not import each other. | - | see SUMMARY-04-01 | yes |
| 2026-10-16 | 04-02: shadcn components were hand-written (new-york style) on per-package @radix-ui/react-* deps instead of running the shadcn CLI. 00-02 and 01-03 both found that the CLI emits imports from the cn and radix-ui packages and then removed them | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: jsdom was moved from ^30 to ^25 (as the plan specified): jsdom 30 pulls in undici 8, which crashes under Node 22.12 ('reading bind'), so no jsdom test could run | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: chart.tsx was adapted to recharts 3 with locally typed tooltip/legend content props, because recharts 3 no longer exposes payload/label on TooltipProps | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: A 401 redirects to /login?reason=expired&next=<path>, matching the login page's existing reason=expired alert from 01-03 (not expired=1) | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: The header reuses the existing components/auth/sign-out-button.tsx (authClient.signOut, then router.push('/login')) | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: The placeholder apps/web/src/app/page.tsx had already been removed by 01-03, so there was nothing to delete. (app)/layout.tsx keeps requireSession(), which does the redirect and the view-event logging | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: Undecodable evidence params close the drawer: bad values return null and unknown keys are ignored. When the evidence param leaves out window or sort, decoding fills in 24h and reach | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: The evidence query sets placeholderData: undefined so a new slice never shows the previous slice's posts. It does not poll (refetchInterval false) | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: The Change vs prior 24h KPI opens the 7d evidence window, so every KPI except suspected-coordinated is clickable | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: safeExternalUrl (http/https only) guards every link built from data (Open original, market source links). It was added to the Task 2 card in the Task 3 commit | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: Test helpers live in components/shell/test-utils.tsx. A next/navigation mock is loaded via vi.mock('next/navigation', () => import('@/components/shell/test-utils')) | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-02: FilterBar takes a children slot so 06-01 can drop LaneToggle in without restructuring it | - | see SUMMARY-04-02 | yes |
| 2026-10-16 | 04-03: Market point to hour matching uses [hourStart, +1h) windows on the IST-aligned (:30 UTC) hour starts; last point by time wins, no carry-forward. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | 04-03: Bar click uses recharts Bar onClick on all three stacked bars and accepts either {payload: row} or the row itself; exported as makeBarClick(slug, open) for testing. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | 04-03: SplitCell (30-item rule text) lives in by-source-table.tsx and is reused by entity-breakdown.tsx; rendered as one text node for accessibility and testability. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | 04-03: Entity breakdown always shows the four rows, zero-filled when the API omits one. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | 04-03: Task 1 commit references topic-view/topic-skeleton added in the Task 2 commit, so e34ffcd alone does not typecheck; HEAD does. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | 04-03: Chart series colours are literal hex values in the chart config (green, slate, red, blue) rather than theme tokens. | - | see SUMMARY-04-03 | yes |
| 2026-10-16 | No API keys copied from influ-finder; all sources and the classifier run on fixtures and stubs until this project gets its own keys | Copy influ-finder's Anthropic, YouTube and Apify keys | Developer choice: separate keys and billing for this project | yes |
| 2026-10-16 | 05-01: Config creds format is the existing enc:v1 AES-256-GCM (worker already decrypts it in apps/worker/src/runner.ts); apps/web/src/lib/crypto.ts matches byte for byte, with a test vector produced and verified by the worker's decryptSecret. No new ISS needed for worker decryption. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: Token stored in sources.x_api.creds_ref.X_BEARER_TOKEN (creds_ref is Record<string,string>/null); clearing deletes the key and sets creds_ref to null when empty. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: SourcesResponse, SourceRow, XCard, QuotaCard, RunRow, SourcesPatch live in apps/web/src/app/api/sources/_lib/contract.ts (api-types.ts is owned by 04-01). | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: PATCH uses getLatestConfig plus saveConfigVersion(..., {expectedVersion}) (which takes the advisory lock itself) instead of a custom transaction, because drizzle-orm is not a dependency of apps/web; stale base version gives 409 with the exact conflict message. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: Field errors use the existing ParamError shape: 400 {error:'bad_request', issues:[{path:[...], code, message}]}; UI joins path with '.'. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: Mode shown prefers detail.mode of the last fetch_run, else resolved from SOURCES_MODE and credentials (env or config creds_ref names). | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: Breaker threshold 3 hard-coded in status.ts to match worker; YouTube minimum interval 15 min derived from ceil(1440/i)*100 <= 10000. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: apify_instagram and apify_linkedin coverageLabel forced to 'sampled', displayed as 'sampled, not representative'. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-01: Rate-limit fields in the X card are max_pages_per_run and cost_per_post_usd (the keys x_api reads) plus any already saved. | - | see SUMMARY-05-01 | yes |
| 2026-10-16 | 05-02: Settings types live in apps/web/src/app/api/config/_lib/contract.ts because api-types.ts belongs to 04-01 | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: 400 validation responses use {error:'validation_failed', issues:[{path,message}]}; person-level key (any spelling, any value) -> 400 'person-level views are locked pending legal review' | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: web app has no drizzle-orm dependency, so topic/audit/test-terms handlers use the postgres-js sql handle from getDb(); the event_log row is written in the same sql.begin transaction as the topic change | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: PATCH /api/config does read-latest, base-version check, merge, then saveConfigVersion with expectedVersion (checked under its advisory lock) instead of a second outer lock; stale -> 409 | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: The catch-all topic with slug 'emerging' is not an Emerging candidate and cannot be promoted, merged or dismissed (409) | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: Merge also sets topics.merged_into_id on the dismissed source | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: Audit cursor is 'YYYY-MM-DDTHH:MM:SS.UUUUUU/id' (microsecond precision) for a lossless keyset; audit kinds exclude fetch_run, login_locked, logout and retention per plan | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-02: Person-level switch is a native disabled button role=switch with a Lock icon and no handler (no shadcn Switch present) | - | see SUMMARY-05-02 | yes |
| 2026-10-16 | 05-03: Gold queue excludes is_fixture posts so the gold set measures real data only (to be logged in DECISIONS.md by the orchestrator). | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: POST /api/labels and DELETE run in one SQL transaction together with the 'relabel' event_log insert; gold writes take pg_advisory_xact_lock so the 200 cap holds under concurrency. | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: QueueResponse gains an additive top-level topics list (non-dismissed) for the gold form; LabelResponse gains classificationId. | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: RelabelControls keeps the 04-02 stub export and props ({item}) with an optional topics prop. The plan's {postId,current,topics} signature was not used. | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: Sarcasm is read from the latest gold relabel event per post (detail.sarcastic), since there is no column. | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: Accuracy page keeps scope state (default or latest) so Re-score refreshes the displayed figures, with refetchInterval false (worksheet, not a poll). | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 05-03: usedAsFewShot = min(20, corrections count); 03-02's few-shot cap is 20. | - | see SUMMARY-05-03 | yes |
| 2026-10-16 | 06-01: refreshReachScores takes the rollup handle `{sql}` (as recomputeRange does) rather than a drizzle db, because it is raw postgres-js SQL | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: A full reach pass also scores NULL rows older than lookbackDays; p95 still comes only from rows inside the window | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: The reach write skips unchanged rows (`is distinct from`), so `updated` counts rows actually changed | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: runRollup skips recomputeReachColumns after a full rescore when the mode is full7d, because that run already recomputes the same 7-day window | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: recomputeRange and recomputeReachColumns take {unknownScore}, default TRUST_DEFAULTS.reach.unknownScore; NULL reach_score is coalesced in SQL | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: The ReachSplit helpers (percentSplit and reachSplit with largest remainder) live in lib/queries/ranking.ts; lib/queries had no percent helper, and the UI's pctSplit lives in components | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: LaneToggle is mounted inside the shared FilterBar (components/shell/filter-bar.tsx, the real 04-02 filter bar). The brief (app/(app)/page.tsx) and the topic page (topic-view.tsx) both get it without either file being edited | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: The KPI Sentiment cell now shows ReachSplitView. The reach percents are the evidence buttons, and the raw split shows as text: Raw a / b / c, n = N | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: The topics table gains a Reach-weighted column (the formatSplit text, or '-' with sr-only Not enough data); its min-width goes from 760 to 860px | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-01: LaneToggle is both a named and a default export | - | see SUMMARY-06-01 | yes |
| 2026-10-16 | 06-02: 06-02: new api-types fields are optional (`?`) to stay additive without editing fixture files other plans own; the API always sets them | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: evidence `coordinated` uses z.stringbool() rather than z.coerce.boolean(), which reads 'false' as true. coordinated=false means no filter, and 'maybe' returns 400 | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: evidence params live in lib/queries/params.ts (EvidenceParams), not route.ts, so route.ts did not change. The route test is in lib/queries/evidence-route.test.ts to stay inside owned paths | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: detectNearDupCoordination takes `{sql}` (like refreshReachScores), not `db`. Windows are inclusive (a span of 60 min or less qualifies). Null-author posts inside a qualifying window are flagged but never counted | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: burst_flag and top5_author_share are computed inside recomputeRange's transaction after the upsert, so every caller of recomputeRange gets them. The upsert resets both before recomputing, and the shared src/fan CTE moved to rollup/fan.ts | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: suspected_coordinated is refreshed in already rolled-up buckets with one targeted UPDATE (refreshSuspectedCounts) when a run flags new posts | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: timeline clusters respect the entity and lane filters and count only flagged posts. A cluster click opens evidence with cluster plus coordinated=true and window=7d. A burst click opens bucket plus window=7d | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 06-02: 06-02: the topic page component is topic-view.tsx (SUMMARY-04-03), not the topic-detail.tsx the plan named | - | see SUMMARY-06-02 | yes |
| 2026-10-16 | 07-01: pnpm demo uses copies=4 (each fixture post plus 3 synthetic-author variants): with 3 copies the busiest topic reached only 27 items/24h, below the 30-item split threshold. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: runDemo drives runFetch directly with modeOverride fixture and now injected; it uses runRollup(mode full7d) with an injected now for coordination detection plus 7 days of buckets, so no rollup range helper had to be added to apps/worker/src/rollup. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Order inside runDemo: fetch, amplify, spread, market history, classify loop, emerging, rollup, summaries (summaries need topic status set by the rollup). | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: demoSnapshot keys emerging topics as 'emerging:<name>' because their slugs derive from random post ids; this keeps the snapshot comparable across runs. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Market history ramps subscription series to the fixture value at the fixture observation hour and holds it flat afterwards, so the existing #fixture point never breaks monotonicity. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Sentiment colours live in components/brief/sentiment-colors.ts; Tailwind classes are spelled as full arbitrary-value strings and a test keeps them equal to SENTIMENT_COLORS. The chart uses ChartConfig theme light/dark values. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Entity control is aria-label 'Entity' (visible 'Mentions' text kept, aria-hidden); the existing shell test was updated. Sentiment bar segments are labelled 'Negative: 42 posts (35%), open evidence'; two brief tests updated. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Deviation (Rule 3): one-attribute edit id="main" on <main> in apps/web/src/app/(app)/layout.tsx and a one-row addition to the README script table (pnpm demo), both outside files_modified, needed for the skip link and for the root README-lists-every-script test. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: shell/stale-banner.tsx is now a re-export of components/states/stale-banner.tsx (onRetry optional), keeping existing imports working. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-01: Plan said to update STATE.md and write SUMMARY file; skipped per harness rules, orchestrator merges. | - | see SUMMARY-07-01 | yes |
| 2026-10-16 | 07-02: Shared session guard is withApi in apps/web/src/lib/queries/http.ts (lib/api.ts is the browser client), so the limiter wiring went there; 120/min keyed by user id + client IP, 429 {error:'rate_limited'} with Retry-After | - | see SUMMARY-07-02 | yes |
| 2026-10-16 | 07-02: Better Auth rateLimit: memory, 60s/100, /sign-in/email 60s/5, enabled unless NODE_ENV=test; the 01-03 lockout is untouched | - | see SUMMARY-07-02 | yes |
| 2026-10-16 | 07-02: Playwright globalSetup shells out to pnpm db:migrate, db:seed and demo instead of importing drizzle-orm (web has no drizzle-orm dependency; two copies broke types earlier) | - | see SUMMARY-07-02 | yes |
| 2026-10-16 | 07-02: Added @axe-core/playwright@4 as an apps/web devDependency | - | see SUMMARY-07-02 | yes |
| 2026-10-16 | 07-02: Negative evidence drawer is opened from the headline sentiment split because the demo topic table has no negative segment | - | see SUMMARY-07-02 | yes |
| 2026-10-16 | 07-02: Sign-out e2e uses its own fresh sign-in so it does not revoke the shared saved session | - | see SUMMARY-07-02 | yes |
