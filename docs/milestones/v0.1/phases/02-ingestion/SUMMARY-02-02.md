---
phase: 02-ingestion
plan: 02
requires:
  - { phase: 02-ingestion, provides: [SourceAdapter stubs, fixtureFetch, createFakeFetch, RateLimitedError/SourceAuthError/SourceParseError/NotConfiguredError in breaker.ts, runner creds resolution] }
  - { phase: 01-data-and-login, provides: [TermsConfig, SourceConfig (x_tier, rate_limits, coverage_label)] }
provides:
  - "buildXQueries(terms, { maxLen }) in x-api.ts: queries within 512 chars (4096 for pro/enterprise), each ending ' -is:retweet'; bare jio/Ambani and generic hashtags only inside co-occurrence groups; negative terms not excluded"
  - "X_MEDIA_HANDLES and xAuthorKind(): media_outlet for listed handles; public_figure when verified (verified or verified_type blue/business/government) and followers >= 100000; else other"
  - "xPostUrl(username, id): canonical https://x.com/<user>/status/<id> (or /i/web/status/<id>), shared by x_api and x_apify"
  - "x_api reads the token from ctx.creds.X_BEARER_TOKEN (runner already resolves config creds_ref over env) and the tier from ctx.source.x_tier; max pages from rate_limits.max_pages_per_run (default 3); cost from rate_limits.cost_per_post_usd else X_COST_PER_POST_USD = 0.005"
  - "x_api cursor: JSON map of query hash to newest_id; later runs send since_id, first runs send start_time (since, clamped to now - 7d + 60s); 429 -> RateLimitedError(resetAt from x-rate-limit-reset, else now + 15 min)"
  - "runApifyActor(client, { actorId, input, maxItems, signal, waitSecs=540 }), ApifyLike, ApifyFactory and defaultApifyFactory in x-apify.ts (60s wait slices, aborts the Apify run on signal abort or overrun, cost = usageTotalUsd)"
  - "Actor id constants: X_APIFY_ACTOR 'apidojo/tweet-scraper', INSTAGRAM_ACTOR 'apify/instagram-hashtag-scraper', LINKEDIN_ACTOR 'harvestapi/linkedin-post-search'; MAX_ITEMS_PER_RUN = 100 in both Instagram and LinkedIn adapters"
  - "createXApiAdapter, createXApifyAdapter, createApifyInstagramAdapter, createApifyLinkedinAdapter factories (fetch/apify/now injectable, resolved lazily); each file default-exports the adapter"
affects: [02-03, 02-04, 03-classification, 04-dashboard, 05-operator-pages, 07-hardening]
key_files:
  - apps/worker/src/adapters/x-api.ts
  - apps/worker/src/adapters/x-apify.ts
  - apps/worker/src/adapters/apify-instagram.ts
  - apps/worker/src/adapters/apify-linkedin.ts
  - apps/worker/src/adapters/__fixtures__/
key_decisions:
  - "Missing credentials in live mode throw NotConfiguredError('<CRED> missing: live mode not built without credentials'): keeps 02-01's fixtures.test.ts (substring 'live mode not built') green without editing it"
  - "X_COST_PER_POST_USD = 0.005 estimate (pay-per-use), overridable per source via rate_limits.cost_per_post_usd"
  - "Apify X items are keyed to the same canonical url as x_api, built from username + id (username also recovered from the item link)"
  - "Invalid Apify X items are counted in rawJson.dropped.invalid of the first returned post (FetchResult has no meta field)"
issues_created: []
completed: 2026-10-16
---

# 02-02: Social adapters (X API, Apify X, Instagram, LinkedIn)

**Live X API v2 recent-search adapter with a length-bounded query builder and 429 handling, plus an abortable Apify actor runner powering the X fallback and capped, sampled Instagram and LinkedIn adapters, all tested against synthetic recorded responses.**

## Accomplishments

- x_api: query builder (all tiers' limits respected), bearer-token paging, per-query newest_id cursor, since_id/start_time logic, RateLimitedError with resetAt, SourceAuthError on 401/403, token never in error messages.
- runApifyActor honours AbortSignal (aborts the Apify run) and reports real usageTotalUsd.
- Instagram and LinkedIn capped at 100 posts per run, `rawJson.sampled = true`, authors conservative (`other`, LinkedIn media companies by name).
- Fixture mode unchanged for all four (no client or fetch constructed).

## Task commits

1. Task 1: X API v2 recent-search adapter with query builder - `70a5775` (feat)
2. Task 2: Apify actor runner and X fallback adapter - `7daa2f8` (feat)
3. Task 3: Apify Instagram and LinkedIn sampled adapters - `66a6929` (feat)

## Decisions

- Missing creds in live mode throw NotConfiguredError whose message contains "live mode not built" (see key_decisions).
- Config knobs live in the free-form `rate_limits` record: `max_pages_per_run`, `cost_per_post_usd`.
- Cost estimate X_COST_PER_POST_USD = 0.005 USD per post (to be recorded in DECISIONS.md by the orchestrator).

## Deviations from plan

None beyond the above. The plan's STATE/DECISIONS edits were skipped per the workflow instructions.

### Deferred to ISSUES.md
- Verify the Apify actor ids and output field names (apidojo/tweet-scraper, apify/instagram-hashtag-scraper, harvestapi/linkedin-post-search) on the first live run; they cannot be checked offline.
- x_api with the default term set issues about 12 queries per run at 512 chars (up to 3 pages each, every 2 min): check against the tier's rate limit and spend before going live; consider raising tier or lowering cadence.
- 429 mid-run discards posts already fetched in that run (cursor not advanced, so they are re-read next time).

## Verification

- Tests: `vitest run src/adapters/x-api.test.ts x-apify.test.ts apify-instagram.test.ts apify-linkedin.test.ts` -> 24 + 17 + 7 + 9 passed. Full worker suite: 317 passed, 4 failed; the failures are other wave-2 plans' in-progress files (reddit/news_rss/web_search stub tests in fixtures.test.ts, and index.test.ts counting portal runs).
- Types / lint: eslint clean on all my files; tsc shows no errors in my files (other errors come from files owned by concurrent plans).

## Next-phase readiness

- adapters/index.ts is untouched; the four defaults are real SourceAdapters with the stubs' key, lane and requiredCreds.
- Later plans reuse `runApifyActor` and `xAuthorKind` from the worker adapters.
