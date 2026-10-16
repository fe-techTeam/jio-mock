# v0.1 contracts

Binding interfaces shared across phases. Parallel plans rely on these names and paths. Change them only through a DECISIONS.md entry, and update this file in the same commit.

Design sources: `docs/specs/2026-10-16-jio-ipo-analysis-design.md` (resolutions, which win) and `docs/specs/2026-10-16-jio-ipo-analysis-brew.md` (full design).

## Tooling

- Node 22 (installed via nvm). pnpm 9 through corepack: the root `package.json` sets `"packageManager": "pnpm@9.15.4"`; run `corepack enable` once, or prefix with `corepack pnpm`.
- TypeScript 5 strict, ESM everywhere (`"type": "module"`). Base config `tsconfig.base.json`.
- ESLint 9 flat config at the root (`eslint.config.mjs`), Prettier (`.prettierrc`), Vitest 2 (each package has its own `vitest.config.ts`; the root `pnpm test` runs `pnpm -r test`).
- Root scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm format`, `pnpm db:up` (docker compose up -d db), `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev` (web + worker in parallel), `pnpm --filter web e2e`.
- `docker-compose.yml` service `db`: image `pgvector/pgvector:pg16`, host port **5433**, user/password/db `jio`/`jio`/`jio_ipo`, named volume. Tests use database `jio_ipo_test` on the same server (created by `scripts/test-db.sh` or a Vitest globalSetup).
- Web dev server on port **3100**.
- CI: `.github/workflows/ci.yml` runs install, lint, typecheck and test, with a pgvector service container.

## Layout

```
apps/web/            Next.js 15 App Router, src/ dir, Tailwind, shadcn/ui (new-york, neutral), TanStack Query
apps/worker/         Node 22 worker: pg-boss scheduler, adapters, classify, rollup, trust, retention
packages/db/         @jio/db   Drizzle schema, client, migrations, query helpers, seed
packages/core/       @jio/core pure domain types, zod schemas, keyword matcher, seed data, API response types, time helpers
docs/milestones/v0.1/
```

Workspace package names are `@jio/web`, `@jio/worker`, `@jio/db` and `@jio/core`. Internal packages are consumed as TS source (`"exports": {".": "./src/index.ts"}`). The web app sets `transpilePackages: ['@jio/db','@jio/core']`. The worker runs with `tsx`.

## Environment (`.env.example` at the root, loaded by each app)

```
DATABASE_URL=postgres://jio:jio@localhost:5433/jio_ipo
DATABASE_URL_TEST=postgres://jio:jio@localhost:5433/jio_ipo_test
BETTER_AUTH_SECRET=            # 32+ random chars
BETTER_AUTH_URL=http://localhost:3100
SEED_USER_EMAIL=strategy@jio.local
SEED_USER_PASSWORD=            # set locally; the seed refuses to run when empty
CONFIG_ENCRYPTION_KEY=         # 32-byte base64; encrypts source credentials stored in config
SOURCES_MODE=auto              # auto | fixture | live. auto = live when the source's key is present, else fixture
ANTHROPIC_API_KEY=             # classifier + summaries; empty -> deterministic stub
CLASSIFIER_MODEL=claude-haiku-5-5
VOYAGE_API_KEY=                # multilingual embeddings (voyage-multilingual-2, 1024 dims); empty -> hashing stub
X_BEARER_TOKEN=                # optional; the X tier and token can also be saved from the Sources page
APIFY_TOKEN=
YOUTUBE_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
SERPER_API_KEY=                # web search (Google results, supports site: queries)
```

Secrets live only in `.env`, which git ignores. A missing key never crashes anything: that source runs in fixture mode and the Sources page shows it as `fixture`.

## Domain constants (`@jio/core`)

```ts
type SourceKey = 'x_api' | 'x_apify' | 'youtube' | 'reddit' | 'news_rss' | 'web_search'
  | 'apify_instagram' | 'apify_linkedin' | 'portal_chittorgarh' | 'portal_investorgain' | 'portal_ipowatch'
type Lane = 'social' | 'media'
type Sentiment = 'positive' | 'neutral' | 'negative'
type EntityKey = 'mukesh' | 'akash' | 'isha' | 'jio'
type EntityFilter = 'all' | EntityKey
type LaneFilter = 'all' | Lane
type Lang = 'en' | 'hinglish' | 'hi' | 'gu' | 'other'
type Confidence = 'high' | 'low'
type MarketSeries = 'gmp_inr' | 'sub_retail_x' | 'sub_nii_x' | 'sub_qib_x' | 'sub_total_x'
type TopicKind = 'seed' | 'emerging' | 'unclassified'
```

`packages/core/src/config-schema.ts` exports zod `TermsConfig`, `SourceConfig` and `AppConfig` (matching the Config entity) plus `DEFAULT_CONFIG`. `DEFAULT_CONFIG` holds the seed keyword, hashtag, entity-alias, co-occurrence and negative-term lists, copied verbatim from the brew spec Assumptions, and the cadence table from the design resolutions. `packages/core/src/seed-topics.ts` exports the 10 seeded topics (slug, name, description, example_phrases) plus `emerging` and `unclassified`, using the resolved taxonomy.

## Database (`@jio/db`)

Drizzle `pgTable` definitions in `packages/db/src/schema.ts`, with field lists from the brew spec Data section. Table names are snake_case plural: `posts`, `authors`, `classifications`, `topics`, `topic_stats_15m`, `market_points`, `config_versions` and `event_log`. Better Auth tables (`user`, `session`, `account`, `verification`) are in `packages/db/src/auth-schema.ts`. Extra columns decided here:
- `posts.is_fixture boolean not null default false`: fixture data can be purged when sources go live.
- `posts.embedding vector(1024)`, nullable.
- `posts.lang`, `posts.content_hash` (sha256 of normalized text), `posts.near_dup_cluster_id` (text, nullable).
- `classifications.origin`: `model | correction | gold`. The effective label is the latest correction or gold row, otherwise the latest model row. View `effective_classifications` (SQL in a migration) exposes one row per post.
- `topic_stats_15m` primary key `(bucket_start, topic_id, entity, lane)`.

Exports from `packages/db/src/index.ts`: `createDb(url)` returns `{ db, sql }` (postgres-js driver), `schema`, and query helpers in `packages/db/src/queries/*.ts`:
- `config.ts`: `getLatestConfig(db): Promise<{version, config: AppConfig}>`, `saveConfigVersion(db, config, actor): Promise<number>` (also writes a `config_change` event).
- `events.ts`: `logEvent(db, e)`, `sourceHealth(db): Promise<SourceHealthRow[]>` (last success, last error, items in 24h, spend in 24h, consecutive failures).
- `posts.ts`: `upsertPosts(db, NormalizedPost[], {isFixture}) : Promise<{inserted, duplicates}>`, deduped on `(source_key, external_id)`, upserting authors.
- `market.ts`: `insertMarketPoints(db, NormalizedMarketPoint[])`.

Migrations live in `packages/db/migrations` (drizzle-kit generate). The first migration enables `vector` and `pgcrypto`.

## Worker (`@jio/worker`)

```ts
// packages/core/src/adapter.ts
interface NormalizedAuthor { platform: string; platformUserId: string; handle?: string; displayName?: string;
  followers?: number; kind?: 'media_outlet' | 'public_figure' | 'other' }
interface NormalizedPost { sourceKey: SourceKey; externalId: string; url: string; author: NormalizedAuthor | null;
  text: string; publishedAt: Date; reachRaw: Record<string, number>; rawJson: unknown }
interface NormalizedMarketPoint { series: MarketSeries; value: number; observedAt: Date; sourceKey: SourceKey; sourceUrl: string }
interface FetchContext { since: Date; cursor?: string; source: SourceConfig; terms: TermsConfig;
  mode: 'live' | 'fixture'; signal: AbortSignal; creds: Record<string, string | undefined> }
interface FetchResult { posts: NormalizedPost[]; marketPoints?: NormalizedMarketPoint[]; nextCursor?: string; costUsd: number }
interface SourceAdapter { key: SourceKey; lane: Lane; requiredCreds: string[]; fetch(ctx: FetchContext): Promise<FetchResult> }
```

- Adapters live at `apps/worker/src/adapters/<file>.ts`: `x-api.ts`, `x-apify.ts`, `youtube.ts`, `reddit.ts`, `news-rss.ts`, `web-search.ts`, `apify-instagram.ts`, `apify-linkedin.ts`, `portal-chittorgarh.ts`, `portal-investorgain.ts`, `portal-ipowatch.ts`. Each default-exports a `SourceAdapter`. Fixtures are in `apps/worker/fixtures/<sourceKey>.json` (realistic sample posts in English, Hinglish, Hindi and Gujarati; portal fixtures are saved HTML).
- `apps/worker/src/adapters/index.ts` exports `ADAPTERS: Record<SourceKey, SourceAdapter>`. It is created in 02-01 with every file stubbed (fixture-only). Later plans replace the stub bodies and never edit index.ts.
- pg-boss queue names: `fetch-source` (payload `{sourceKey}`), `classify-batch`, `rollup`, `summaries`, `emerging`, `retention`. `apps/worker/src/scheduler.ts` ticks every 60s, reads the latest config, and enqueues due fetches (market-hours logic for portals: 09:15-15:30 IST Mon-Fri, helper `isIndianMarketHours(date)` in `@jio/core/time`).
- Classifier: `apps/worker/src/classify/classifier.ts` defines `interface Classifier { classify(items: {postId, text, lang}[], topics: TopicDef[]): Promise<ClassifyResult[]> }`, with `ClassifyResult = { postId, topicSlug, sentiment, entities: EntityKey[], confidence, glossEn }`. Implementations are `anthropic.ts` (model from `CLASSIFIER_MODEL`, JSON-schema output, batches of 20-50, cached by content_hash, scraped text wrapped as untrusted data) and `stub.ts` (deterministic keyword rules). An embedder interface sits in `classify/embedder.ts`, with `voyage.ts` and `stub.ts` (hashed bag-of-words, 1024 dims).

## Web API (`apps/web/src/app/api/**`)

Every route checks the Better Auth session (401 without one) and validates query params with zod (400). A database error returns 503 `{error}`. Response types live in `packages/core/src/api-types.ts`:

- `GET /api/health` -> `{ ok: true, db: 'up' | 'down' }` (public, no session)
- `GET /api/brief?entity=&lane=` -> `BriefResponse { asOf, kpis: {items24h, itemsPrev24h, pos, neu, neg, lowConfPct, suspectedCoordinated}, topics: TopicRow[] (ranked, active only), emerging: {count}, unclassified: {count}, market: MarketStrip, freshness: SourceFreshness[] }`, cached 15s
- `GET /api/topics/:slug/timeline?entity=&lane=` -> `TimelineResponse { topic, asOf, series: HourPoint[] (7d hourly), market: MarketSeriesPoints, bySource, byEntity }`
- `GET /api/evidence?topic=&sentiment=&entity=&lane=&window=24h|7d&cursor=` -> `EvidencePage { items: EvidenceItem[], nextCursor }`. Author handles appear only when author.kind is media_outlet or public_figure.
- `POST /api/labels` `{postId, origin:'correction'|'gold', sentiment, topicSlug, entities}` -> `{ok}`
- `GET|PATCH /api/config` and `GET|PATCH /api/sources`. Credentials are write-only (the API returns `credsSet: boolean`, never the value).
- `GET /api/accuracy` -> gold-set progress and per-language accuracy.

Auth: `apps/web/src/lib/auth.ts` (Better Auth server, Drizzle adapter, email and password, sign-up disabled), `apps/web/src/lib/auth-client.ts`, and `apps/web/src/middleware.ts`, which redirects unauthenticated page requests to `/login`. The seed user is created by `pnpm db:seed` through Better Auth's server API. Login is locked for 15 minutes after 5 failed attempts.

UI: shadcn components in `apps/web/src/components/ui`; app components in `apps/web/src/components/<area>/`. TanStack Query provider in `apps/web/src/components/providers.tsx` with `refetchInterval: 30_000`, `placeholderData: keepPreviousData`. Filters live in the URL search params (`entity`, `lane`, `evidence`).
