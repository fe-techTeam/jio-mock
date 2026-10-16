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
