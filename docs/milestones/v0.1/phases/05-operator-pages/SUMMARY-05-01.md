---
phase: 05-operator-pages
plan: 01
requires:
  - { phase: 01-data-and-login, provides: "AppConfig/SourceConfig (interval_min, market_hours_interval_min, coverage_label, x_tier, rate_limits, creds_ref), getLatestConfig, saveConfigVersion(expectedVersion), sourceHealth, recentFetchRuns, prepareTestDb/connectTestDb/truncateAll, seedBase" }
  - { phase: 02-ingestion, provides: "fetch_run events with detail.mode and detail.quota, breaker threshold 3, enc:v1 decryptSecret in the worker" }
  - { phase: 04-dashboard, provides: "withApi/apiError/ParamError, readCtx, Providers, shell format helpers, StaleBanner, ui primitives" }
provides:
  - "apps/web/src/lib/crypto.ts: encryptSecret, decryptSecret, isEncrypted, CredentialKeyError (enc:v1 AES-256-GCM, worker compatible)"
  - "GET and PATCH /api/sources (SourcesResponse for all 11 sources, 401/400/409/503), GET /api/sources/[key]/runs (max 10)"
  - "apps/web/src/app/api/sources/_lib/contract.ts: SourcesResponse, SourceRow, XCard, QuotaCard, RunRow, SourcesPatch, FieldIssue"
  - "/sources page: status/mode table, inline cadence editor, last 10 runs, X config card, YouTube quota card"
affects: [06-trust-layer, 07-hardening]
key_files:
  - apps/web/src/lib/crypto.ts
  - apps/web/src/app/api/sources/route.ts
  - apps/web/src/app/api/sources/[key]/runs/route.ts
  - apps/web/src/app/api/sources/_lib/contract.ts
  - apps/web/src/app/api/sources/_lib/status.ts
  - apps/web/src/app/api/sources/_lib/validate.ts
  - apps/web/src/app/api/sources/_lib/save.ts
  - apps/web/src/app/api/sources/_lib/build.ts
  - apps/web/src/app/api/sources/_lib/queries.ts
  - apps/web/src/components/sources/sources-view.tsx
  - apps/web/src/components/sources/sources-table.tsx
  - apps/web/src/components/sources/interval-editor.tsx
  - apps/web/src/components/sources/x-config-card.tsx
  - apps/web/src/components/sources/quota-card.tsx
key_decisions:
  - "Config creds format is the existing enc:v1 (worker already decrypts it); web crypto matches byte for byte, verified with a worker-produced test vector"
  - "PATCH uses getLatestConfig + saveConfigVersion with expectedVersion (drizzle-orm is not a web dependency); stale baseVersion gives 409 'Config changed since you opened it, reload'"
  - "Field errors reuse ParamError: 400 {error:'bad_request', issues:[{path, code, message}]}"
  - "Mode prefers the last fetch_run's detail.mode, else SOURCES_MODE plus env/config credentials"
issues_created: [credsSet reflects config only, quota reset off by an hour on DST-change days, no enabled toggle in UI]
completed: 2026-10-16
---

# 05-01: Sources page

**The honest "real time" panel at /sources: all 11 sources with lane, status (ok, stale, circuit open, waiting, disabled), mode (live or fixture with missing keys named), last success, next run (IST), editable cadence (portals edit market-hours and regular intervals), items, spend, coverage label and the last 10 runs, plus a write-only encrypted X bearer token card and a YouTube quota card.**

## Accomplishments

- crypto.ts: AES-256-GCM, `enc:v1:` + base64url(iv12|tag16|ct); CredentialKeyError names CONFIG_ENCRYPTION_KEY, never its value. A blob produced by the worker format decrypts in a test vector.
- status.ts (pure): effectiveIntervalMin (portals use the market-hours interval 09:15-15:30 IST Mon-Fri), deriveStatus (disabled, waiting, circuit_open at 3 failures, stale beyond 2 x interval, ok), nextRunAt, REQUIRED_CREDS, resolveMode, xModeLabel, minYoutubeIntervalMin (15).
- API: response built from an explicit field allowlist; credentials never returned (x.credsSet is a boolean). PATCH validates integers 1..1440, market-hours interval only for portals and at most the base interval, YouTube at least 15 min, token 20..512 chars without whitespace; saves a new config version as actor 'operator' (config_change event holds only version numbers).
- UI: polling via provider defaults, skeleton, error panel with Retry, amber stale banner, inline 400 field errors that keep the typed value, 409 reload message with Reload button, token input always empty.

## Task commits

1. Credential crypto and pure source-status logic
2. GET and PATCH /api/sources plus per-source runs
3. Sources page UI with cadence editing, X card and quota card

## Decisions

See key_decisions. Also: token stored at sources.x_api.creds_ref.X_BEARER_TOKEN; Instagram and LinkedIn coverage forced to 'sampled' (shown as "sampled, not representative"); YouTube units come from the latest youtube run's detail.quota when its day equals the current Pacific day.

## Deviations from plan

- No custom transaction or advisory lock call in save.ts: saveConfigVersion already takes pg_advisory_xact_lock and checks expectedVersion; drizzle-orm is not importable from apps/web. Same guarantee.
- Added sources-api.ts, use-patch-sources.ts, sources-view.tsx, build.ts (inside owned globs).
- No DECISIONS.md/ISSUES.md/STATE.md edits, per the workflow rules. The worker already decrypts enc:v1, so the planned worker ISS is not needed.

## Verification

- Sources tests: crypto 11, status 18, validate 11, route integration 18 (on jio_ipo_test_web_sources), component 17 = all passing. eslint and prettier clean on all owned paths; `tsc` shows no errors in owned files; `next build` passes and lists /sources and /api/sources.
- Repo-wide lint currently fails only on 05-03's labels.ts (unused QueueItem); the web suite showed unrelated failures from sibling in-progress files (settings.test.tsx load error, one flaky resetAndSeed run).
- grep: decryptSecret appears only in lib/crypto.ts and its test, never in components.

## Next-phase readiness

- 06/07 can reuse `SourcesResponse` from `apps/web/src/app/api/sources/_lib/contract.ts` and the lib/crypto helpers.
- Integration tests for new routes should call prepareTestDb with their own database name.
