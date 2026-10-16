# Jio IPO analysis

A private public-sentiment board for the Jio IPO: it ingests social and media sources, classifies
each item by topic, sentiment and entity, rolls the results up, and serves them behind a single
login. In v0.1 it runs locally only.

## Prerequisites

- Node 22 (through nvm: `nvm use`, the version is in `.nvmrc`)
- Docker (for Postgres 16 with pgvector)
- pnpm 9 through corepack: run `corepack enable` once, or prefix commands with `corepack pnpm`.
  If corepack fails with "Cannot find matching keyid", set `COREPACK_INTEGRITY_KEYS=0`.

## Quick start

```sh
cp .env.example .env
corepack pnpm install
pnpm db:up          # Postgres on port 5433
pnpm db:test-setup  # creates the jio_ipo_test database
pnpm db:migrate     # available from Phase 01
pnpm db:seed        # available from Phase 01
pnpm dev
```

## Ports

| Service           | Port |
| ----------------- | ---- |
| Web (Next.js)     | 3100 |
| Postgres + vector | 5433 |

## Scripts

| Script               | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `pnpm lint`          | ESLint 9 flat config for the whole repo                  |
| `pnpm typecheck`     | Type-check every package                                 |
| `pnpm test`          | Run every package's tests, then `scripts/tests`          |
| `pnpm build`         | Build every package                                      |
| `pnpm format`        | Format with Prettier                                     |
| `pnpm format:check`  | Check formatting                                         |
| `pnpm db:up`         | Start Postgres in Docker and wait until healthy          |
| `pnpm db:migrate`    | Run Drizzle migrations (available from Phase 01)         |
| `pnpm db:seed`       | Seed config, topics and the login user (from Phase 01)   |
| `pnpm db:test-setup` | Create `jio_ipo_test` (idempotent)                       |
| `pnpm dev`           | Run web and worker in parallel                           |
| `pnpm demo`          | Fill the board from fixtures (`-- --purge` removes them) |

## Layout

```
apps/web/            Next.js 15 App Router, Tailwind, shadcn/ui, TanStack Query
apps/worker/         Node 22 worker: pg-boss scheduler, adapters, classify, rollup, trust, retention
packages/db/         @jio/db   Drizzle schema, client, migrations, query helpers, seed
packages/core/       @jio/core pure domain types, zod schemas, keyword matcher, seed data
docs/milestones/v0.1/
```

## Fixture mode

`SOURCES_MODE` is `auto`, `fixture` or `live`. With `auto`, a source goes live only when its API key
is present and otherwise serves realistic fixture data. A missing key never crashes anything: that
source runs in fixture mode and the Sources page shows it as `fixture`. Secrets live only in `.env`,
which git ignores. CI runs with every key unset.

## Runbook

Everything here runs on one machine. Nothing is exposed to the internet in v0.1.

### Prerequisites

Node 22, `corepack enable` (pnpm 9), and Docker. Postgres runs in Docker on port 5433.

### First run

```sh
cp .env.example .env
openssl rand -base64 32     # paste into BETTER_AUTH_SECRET
openssl rand -base64 32     # paste into CONFIG_ENCRYPTION_KEY
# also set SEED_USER_PASSWORD (at least 12 characters) in .env
corepack pnpm install
pnpm db:up                  # Postgres + pgvector on 5433
pnpm db:migrate
pnpm db:seed                # config, topics and the one login user
pnpm demo                   # fills the board from fixtures, no keys needed
pnpm dev                    # web and worker
```

Open http://localhost:3100 and sign in as `SEED_USER_EMAIL` (default `strategy@jio.local`) with
`SEED_USER_PASSWORD`. Re-running `pnpm db:seed` resets that user's password to the value in `.env`.

### Sources

| Source                         | Env key                                    | Default interval            |
| ------------------------------ | ------------------------------------------ | --------------------------- |
| X (official API)               | `X_BEARER_TOKEN` (or the Sources page)     | 2 min                       |
| X (Apify fallback)             | `APIFY_TOKEN`                              | 10 min                      |
| Reddit                         | `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | 5 min                       |
| YouTube                        | `YOUTUBE_API_KEY`                          | 15 min                      |
| Instagram and LinkedIn (Apify) | `APIFY_TOKEN`                              | 30 min                      |
| Web search                     | `SERPER_API_KEY`                           | 15 min                      |
| News RSS                       | none                                       | 5 min                       |
| Three IPO portals              | none                                       | 60 min (10 in market hours) |

Fixture mode means a source serves bundled sample data instead of calling the network. In
`SOURCES_MODE=auto` a source is live only when its key is present; `fixture` forces samples
everywhere and `live` forces real calls. The Sources page shows `fixture` for every source running
on samples. Instagram and LinkedIn are sampled, not representative.

### Going live

1. Put the keys you have into `.env` (secrets live only there, and git ignores the file).
2. Set `SOURCES_MODE=auto` and restart `pnpm dev`.
3. Remove the sample posts: `pnpm demo -- --purge`.
4. The X access tier and a bearer token can be entered on the Sources page. The token is stored
   encrypted with `CONFIG_ENCRYPTION_KEY` and is never shown again.

`ANTHROPIC_API_KEY` switches classification and the two-line summaries from the deterministic stub
to Claude (`CLASSIFIER_MODEL` picks the model). `VOYAGE_API_KEY` switches embeddings, which feed
Emerging topics, from the hashing stub to real multilingual embeddings. Both are optional.

### Jobs

The worker runs these on pg-boss: source fetches on each source's interval; `classify-batch` and
`rollup` every minute; `summaries` every 30 minutes; `emerging` at minutes 15 and 45; `retention`
daily at 03:00 IST.

### Retention

`raw_json` is cleared after 30 days. Post text, classifications and authors are deleted after 90
days. Rollups (`topic_stats_15m`) and market points are kept. Change the windows on
Settings, Access and retention; the next nightly run uses the new values.

### Sign-in protection

Five wrong passwords for one account lock it for 15 minutes. Sign-in is also limited to 5 requests a
minute per address, and every `/api` route to 120 requests a minute per user and address. The app
sends a strict Content-Security-Policy, `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.

### Security notes

- Secrets belong only in `.env`. Never commit it.
- Rotating `CONFIG_ENCRYPTION_KEY` makes stored credentials unreadable; enter them again on the
  Sources page.
- `X-Forwarded-For` is trusted for the lockout and rate limits, which is only safe behind a proxy
  that sets it. Direct to the app, a client can forge it.

### Tests

```sh
pnpm test                          # unit and integration, databases jio_ipo_test*
corepack pnpm --filter @jio/web exec playwright install chromium   # once
corepack pnpm --filter @jio/web e2e   # builds the app, uses database jio_ipo_e2e on port 3101
```

`pnpm db:test-setup` creates `jio_ipo_test`. The e2e run recreates `jio_ipo_e2e`, seeds it and runs
`pnpm demo` against it; your `jio_ipo` database is never touched. No test calls an external host.

### Backup

```sh
docker compose exec db pg_dump -U jio jio_ipo > backup.sql
```

### Troubleshooting

- Port 5433 busy: stop the other Postgres, or change the host port in `docker-compose.yml` and
  `DATABASE_URL`.
- `extension "vector" is not available`: you are not on the `pgvector/pgvector:pg16` image. Run
  `docker compose down` and `pnpm db:up` to pull the right one.
- A source shows stale on the Sources page: open its row for the last error, check the key and
  quota, and confirm the worker is running (`pnpm dev`). Sources recover on their own after a good
  fetch.
- `Cannot find matching keyid` from corepack: set `COREPACK_INTEGRITY_KEYS=0`.
