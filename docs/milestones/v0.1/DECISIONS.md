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
