---
phase: 00-foundation
plan: 01
requires: []
provides:
  - "Root scripts: lint, typecheck, test, build, format, format:check, db:up, db:migrate, db:seed, db:test-setup, dev"
  - "scripts/pnpm-locked.sh: mkdir-lock wrapper that serialises pnpm across parallel executors"
  - "docker-compose.yml service db (pgvector/pgvector:pg16, host port 5433, jio/jio/jio_ipo) plus jio_ipo_test database via scripts/db-init and scripts/test-db.sh"
  - "Single root ESLint 9 flat config (eslint.config.mjs) covering apps/web (Next + react-hooks), worker and scripts"
  - "tsconfig.base.json (strict, noUncheckedIndexedAccess, Bundler resolution), Prettier config, .nvmrc, pnpm-workspace.yaml"
  - ".env.example with all 17 contract keys, CI workflow, README runbook, node:test repo/env/ci checks in scripts/tests"
affects: [all phases, 00-02, 00-03, ci, docker, lint, tooling]
key_files:
  - package.json
  - pnpm-workspace.yaml
  - tsconfig.base.json
  - eslint.config.mjs
  - docker-compose.yml
  - scripts/pnpm-locked.sh
  - scripts/test-db.sh
  - .env.example
  - .github/workflows/ci.yml
  - README.md
key_decisions:
  - "COREPACK_INTEGRITY_KEYS=0: installed corepack fails npm signature verification (Cannot find matching keyid); export it, pnpm-locked.sh sets it by default"
  - "docker-compose.yml and docs/ are in .prettierignore: Prettier would rewrite the quoted port string the test asserts, and would reformat plan/spec markdown owned by others"
issues_created: []
completed: 2026-10-16
---

# 00-01: Workspace root, Postgres container, CI

**pnpm 9 monorepo root with strict TS base, one ESLint 9 flat config, pgvector Postgres 16 on port 5433 with a jio_ipo_test database, .env.example, CI workflow and README, all guarded by 14 node:test checks.**

## Accomplishments

- `pnpm install`, `lint`, `typecheck`, `test` and `format:check` are green on the empty workspace; frozen-lockfile install works from a clean node_modules.
- `pnpm db:up` brings up a healthy `jio-ipo-db-1` on 5433; `scripts/test-db.sh` is idempotent; vector and pgcrypto are available in jio_ipo_test.
- `scripts/pnpm-locked.sh` serialises installs for wave 2 and leaves no lock behind.

## Task commits

1. Task 1: Workspace root, TypeScript base, lint and format - `09e1d99` (chore)
2. Task 2: Postgres container, test database and env example - `5331d17` (chore)
3. Task 3: CI workflow and README runbook - `acc27ae` (chore)

## Decisions

- Set `COREPACK_INTEGRITY_KEYS=0` (corepack signature-key failure); `corepack enable` was run so nested `pnpm` calls in scripts resolve.
- Added `docker-compose.yml` and `docs` to `.prettierignore`.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] corepack keyid failure** - found in Task 1; fix: COREPACK_INTEGRITY_KEYS=0 in pnpm-locked.sh and README note; verified by: install and `pnpm-locked.sh --version` print 9.15.4.
- **[Rule 3 - blocker] `pnpm` not on PATH inside scripts (`pnpm -r`)** - fix: ran `corepack enable` (writes shims in the nvm node bin dir).
- **[Rule 1 - bug] `prettier --write .` reformatted docs/** - found in Task 3; I restored those files from HEAD (git show, no checkout) and ignored `docs` in Prettier. No docs content changed.
- STATE.md was not edited, per the orchestrator rule that overrides the plan output block.

### Deferred to ISSUES.md
- None.

## Verification

- Tests: `corepack pnpm test` -> 14 passed (repo 5, env-db 5, ci 4), 0 failed
- Build / types / lint: PASS (lint, typecheck, format:check); `docker compose config -q` PASS; test-db.sh run twice

## Next-phase readiness

- Packages must define `typecheck`, `test`, `build`, `dev` scripts; root runs them with `pnpm -r --if-present`. `db:migrate` and `db:seed` need `@jio/db` scripts of those names.
- Use `bash scripts/pnpm-locked.sh <args>` for installs in parallel plans. Export `COREPACK_INTEGRITY_KEYS=0` for direct `corepack pnpm` calls.
- Do not run `pnpm format` repo-wide expecting docs to be touched; use `prettier --write <paths>` for your own files.
