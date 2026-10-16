---
phase: 02-ingestion
plan: 01
requires:
  - { phase: 00-foundation, provides: "pg-boss 10 default import, QUEUES/ensureQueues, loadWorkerEnv, createLogger, isIndianMarketHours" }
  - { phase: 01-data-and-login, provides: "SourceAdapter/FetchContext/NormalizedPost, AppConfig/SourceConfig, DEFAULT_CONFIG, compileMatcher, getLatestConfig, logEvent, sourceHealth, upsertPosts, insertMarketPoints, prepareTestDb" }
provides:
  - "runFetch(deps, sourceKey, opts?) -> RunOutcome; never rejects; default timeouts 600s for x_apify/apify_*, 90s otherwise"
  - "fetch_run event per run: status ok|error|rate_limited, items_new, cost_usd, duration_ms, error (credentials redacted), detail {mode, startedAt, since, cursor, fetched, duplicates, dropped, marketPoints, rateLimitedUntil?, quota?}"
  - "detail.quota convention: copied from a JSON nextCursor's top-level quota object"
  - "since/cursor from the latest ok fetch_run of the same source in the same mode (since = startedAt - 5 min); none -> now - backfill_days"
  - "breaker.ts: threshold 3, max cooldown 120 min, breakerState derived from event_log; RateLimitedError, SourceAuthError, SourceParseError, NotConfiguredError"
  - "runner.ts: resolveMode, resolveCreds (creds_ref over env), decryptSecret (enc:v1 AES-256-GCM), resolvePostLane, sanitizePosts"
  - "scheduler.ts: effectiveIntervalMin, isDue, planTick, resolveSourceModes, startScheduler (60s tick)"
  - "adapters/_fixture.ts helpers, 11 fixture-only adapter stubs, 139 fixture posts across 8 sources plus 3 portal HTML pages"
  - "index.ts: main, runOnce, formatRunTable; --once runs every enabled source once without pg-boss"
affects: [02-02, 02-03, 02-04, 03-classification, 05-01, 05-03, 07-01]
key_files:
  - apps/worker/src/breaker.ts
  - apps/worker/src/scheduler.ts
  - apps/worker/src/runner.ts
  - apps/worker/src/index.ts
  - apps/worker/src/adapters/_fixture.ts
  - apps/worker/src/adapters/index.ts
  - apps/worker/fixtures
issues_created: [ISS-012, ISS-013, ISS-014, ISS-015, ISS-016]
completed: 2026-10-16
---

# 02-01: Ingestion spine

**A 60-second pg-boss scheduler with per-source due logic, IST market hours, an event_log-derived circuit breaker and X primary/fallback routing; a never-throwing fetch runner with mode and credential resolution, timeouts, lane assignment, persistence and one fetch_run event per run; eleven fixture-only adapters with 139 multilingual fixture posts and 3 portal pages, so SOURCES_MODE=fixture fills posts with no keys and no network.**

## Task commits

1. Circuit breaker and scheduler planning logic - `ee8b84f`
2. Fixture helper, adapter stubs, registry and fixtures - `622d4c6`
3. Fetch runner with modes, credentials, persistence and fetch_run events - `e7cb2c9`
4. Scheduler loop, pg-boss wiring and --once mode - `d773f7a`

## Decisions

- fetch_run status ok|error|rate_limited; sourceHealth counts only error, so rate limits never open the breaker.
- Config creds: creds_ref[NAME] wins over env[NAME]; enc:v1 = AES-256-GCM, key base64 CONFIG_ENCRYPTION_KEY, blob `enc:v1:` + base64url(iv12|tag16|ct); decrypt failure counts as missing.
- Post lane: adapter lane, then media_outlet -> media, other/public_figure on a media-lane source -> social.
- Fixture-mode market points get `#fixture` appended to sourceUrl.
- Breaker cooldown min(interval*2^(failures-3), 120) min; isDue allows 5s tick slack.
- index.ts does not reuse boot.ts startWorker (30s graceful stop); fetch-source switched to stately via updateQueue.
- `--once` exits 0 when some sources error; exit 1 only when the DB is unreachable.

## Deviations

- Added drizzle-orm to the worker (runner queries event_log).
- index.ts main guarded by an import.meta.url check so tests can import it.
- pg-boss 10 updateQueue needs `name`.
- Integration tests use per-file DBs jio_ipo_test_worker_{runner,scheduler,index}.

### Deferred
ISS-012 to ISS-016 (see ISSUES.md).

## Verification

- Worker tests: 146 passed at plan close. Typecheck, lint and prettier pass.
- `SOURCES_MODE=fixture ... --once` printed 11 ok rows; a second run inserted 0.

## Next-phase readiness

Wave 2 replaces stub bodies only. 03-03 adds registerJobs at the marked comment in index.ts. 05-01 must emit enc:v1 blobs compatible with decryptSecret. 07-01 uses runOnce({db, env:{SOURCES_MODE:'fixture'}}).
