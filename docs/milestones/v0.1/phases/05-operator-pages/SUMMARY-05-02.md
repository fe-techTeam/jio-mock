---
phase: 05-operator-pages
plan: 02
requires:
  - { phase: 01-data-and-login, provides: "AppConfig/TermsConfig, compileMatcher, getLatestConfig, saveConfigVersion, logEvent, test-db harness" }
  - { phase: 03-classification, provides: "Emerging candidates as topic rows of kind 'emerging' linked via classifications" }
  - { phase: 04-dashboard, provides: "withApi/apiError helpers, shell, providers, IST formatter, ui primitives, api/topics/[slug] segment" }
provides:
  - "GET/PATCH /api/config with versioned saves, 409 on stale baseVersion, locked person_level_views"
  - "POST /api/config/test-terms: current vs draft match counts over the last 24h"
  - "GET/PATCH /api/config/topics, POST /api/topics/[slug]/promote (promote, merge, dismiss), GET /api/config/audit"
  - "Shared client-safe term validator and Settings contract types"
  - "/settings page with Keywords, Topics, Access and retention tabs (?tab= deep links)"
affects: [06-trust-layer, 07-hardening, worker config pickup]
key_files:
  - apps/web/src/app/api/config/_lib/validate.ts
  - apps/web/src/app/api/config/_lib/contract.ts
  - apps/web/src/app/api/config/_lib/save.ts
  - apps/web/src/app/api/config/_lib/topics.ts
  - apps/web/src/app/api/config/route.ts
  - apps/web/src/app/api/config/topics/route.ts
  - apps/web/src/app/api/config/audit/route.ts
  - apps/web/src/app/api/topics/[slug]/promote/route.ts
  - apps/web/src/components/settings/
  - apps/web/src/app/(app)/settings/page.tsx
key_decisions:
  - "Settings types in _lib/contract.ts because api-types.ts is owned by 04-01"
  - "Handlers use the postgres-js sql handle (web has no drizzle-orm); event rows share the change transaction"
  - "PATCH /api/config: base-version check then saveConfigVersion expectedVersion under its advisory lock"
  - "Catch-all 'emerging' topic is not a candidate and cannot be promoted, merged or dismissed"
issues_created: [merge does not backfill older rollup buckets, topic edits last-write-wins, generic_hashtags and anchor_groups not editable, native select and two-step confirm instead of shadcn select and dialog]
completed: 2026-10-16
---

# 05-02: Settings page, config, topics and audit APIs

**Operators can edit IPO terms, hashtags, aliases, co-occurrence and negative terms with live validation and a 24h match test, manage seeded and Emerging topics, set retention and thresholds, and read the audit log, with person-level views locked off.**

## Accomplishments

- Config API: validated PATCH creates exactly one new config version plus one config_change event; stale baseVersion gives 409 "Config changed since you opened it, reload"; sources and creds sections are untouched; person_level_views is forced false and any person-level key in a body is a 400.
- Validator rejects bare 'jio', 'जियो', 'જિયો', 'reliance', 'ambani' (and Devanagari/Gujarati forms), duplicates (case-insensitive), include/negative overlap, bad hashtags, over-80-char and empty terms; retention 1..3650 with raw <= text.
- Topics API: seed edit, Emerging promote/merge/dismiss in single transactions with promote_topic events; audit log with keyset pagination (50 per page), fetch_run excluded and token/secret/password/creds keys redacted recursively.
- Settings UI: three deep-linkable tabs, chip editors with inline errors, dirty bar, Test against last 24h, conflict handling with Reload, Emerging cards with English gloss, locked person-level switch, audit table with Load more.

## Task commits

1. Task 1: Config validation, GET and PATCH /api/config, and term testing - `b1aca9a` (feat)
2. Task 2: Topics, Emerging promotion and audit log APIs - `0df1ed8` (feat)
3. Task 3: Settings page with Keywords, Topics and Access tabs - `3c45812` (feat)

## Decisions

- Types live in `_lib/contract.ts` (api-types.ts is 04-01's).
- 400s use `{error: 'validation_failed', issues}`.
- Raw postgres-js `sql` for topic/audit/test-terms (no drizzle-orm in web); merge also sets `merged_into_id`.
- Slug 'emerging' (catch-all bucket) cannot be promoted/merged/dismissed.
- Audit cursor uses microsecond timestamps for a lossless keyset.
- Person-level switch is a native disabled `role=switch` button with a lock icon (no shadcn Switch).

## Deviations from plan

None material. Handlers use the postgres-js handle instead of drizzle because `drizzle-orm` is not a web dependency and dependencies could not be added.

### Deferred to ISSUES.md
- ISS-NNN: merge does not backfill older topic_stats_15m rollup buckets (found in Task 2)
- ISS-NNN: topic edits are last-write-wins, topics has no version column (Task 2)
- ISS-NNN: generic_hashtags, anchor_groups and entity labels are not editable in Settings (Task 3)
- ISS-NNN: native select and two-step confirm used because no shadcn select/dialog in components/ui (Task 3)

## Verification

- Tests: `corepack pnpm --filter @jio/web test` -> 373 passed (35 files); config 25 + topics/audit 12 + settings UI 9 among them.
- Build / types / lint: typecheck PASS, eslint on owned paths PASS, `next build` PASS (/settings and new API routes listed).

## Next-phase readiness

- Worker already reads the latest config version each tick, so saves take effect without further work.
- Trust layer can reuse `_lib/validate.ts` and the audit endpoint; Accuracy page is independent.
