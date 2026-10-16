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

| Script               | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `pnpm lint`          | ESLint 9 flat config for the whole repo                |
| `pnpm typecheck`     | Type-check every package                               |
| `pnpm test`          | Run every package's tests, then `scripts/tests`        |
| `pnpm build`         | Build every package                                    |
| `pnpm format`        | Format with Prettier                                   |
| `pnpm format:check`  | Check formatting                                       |
| `pnpm db:up`         | Start Postgres in Docker and wait until healthy        |
| `pnpm db:migrate`    | Run Drizzle migrations (available from Phase 01)       |
| `pnpm db:seed`       | Seed config, topics and the login user (from Phase 01) |
| `pnpm db:test-setup` | Create `jio_ipo_test` (idempotent)                     |
| `pnpm dev`           | Run web and worker in parallel                         |

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
