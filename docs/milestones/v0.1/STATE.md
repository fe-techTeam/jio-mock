# v0.1 State

**Goal:** Locally running always-on Jio IPO sentiment board: every source ingested (fixtures until keys), classified, rolled up, served behind one login.
**Current focus:** Phase 00 - Foundation

## Position

Phase: 00 of 07 (Foundation)
Plan: 0 of 3 in this phase
Status: Planning
Last activity: 2026-10-16 - roadmap, contracts and design approved
Progress: 0 / 23

## Recent decisions

- setup: Postgres 16 + pgvector runs in Docker on port 5433 (local Postgres 14 on 5432 lacks pgvector)
- setup: pnpm 9 through corepack (pnpm not installed globally)
- setup: every adapter has a fixture mode, live only when its key is present (no keys yet)
- setup: classifier model claude-haiku-5-5 via @anthropic-ai/sdk; embeddings voyage-multilingual-2 (1024 dims) with a hashing stub

## Open blockers

None.

## Deferred issues

0 open - see ISSUES.md.

## Session continuity

Last session: 2026-10-16
Stopped at: milestone planned; PLAN files being written
Next: execute Phase 00 wave 1 (PLAN-00-01)
