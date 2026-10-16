---
phase: 02-ingestion
plan: 04
requires:
  - { phase: 02-ingestion, provides: [readFixtureText, createFakeFetch, SourceParseError, RateLimitedError, runFetch with #fixture suffix, breakerState, sourceHealth] }
  - { phase: 01-data-and-login, provides: [compileMatcher, insertMarketPoints, upsertPosts] }
provides:
  - "portal-shared.ts: parseNumber, findTable, pickColumn, findIssuerRow, parseObservedAt, withinBounds, extractGmp, extractSubscription, extractNewsLinks, createPortalAdapter(spec, deps?)"
  - "ISSUER_ROW_PATTERN = /\\bjio\\s*platforms?\\b|\\breliance\\s+jio\\b/i, ISSUER_EXCLUDE_PATTERN = /jio\\s*financial|\\bjfsl?\\b/i (never hard-coded IPO dates, price band or lot size)"
  - "Rule: a missing GMP or subscription table throws SourceParseError (breaker counts it, nothing is written); a table without a Jio Platforms row returns 0 points without error (pre-IPO)"
  - "Each portal-*.ts default-exports its adapter and exports `spec`. Fixture mode parses saved HTML; live mode makes 2 GETs (UA jio-ipo-analysis/0.1 (+internal research)); 429 -> RateLimitedError(now+30m); non-2xx -> `HTTP <status> <url>`"
  - "Portal URLs (unverified, ISS): chittorgarh https://www.chittorgarh.com/report/latest-ipo-gmp/56/ and https://www.chittorgarh.com/report/ipo-subscription-status-live-bidding-data-bse-nse/21/; investorgain https://www.investorgain.com/report/live-ipo-gmp/331/ and https://www.investorgain.com/report/ipo-subscription-live/333/; ipowatch https://ipowatch.in/ipo-grey-market-premium-latest-ipo-gmp/ and https://ipowatch.in/ipo-subscription-status-today/"
  - "Fixture market values for Jio Platforms (gmp_inr, sub_qib_x, sub_nii_x, sub_retail_x, sub_total_x), observedAt parsed from the page: chittorgarh 85, 6.82, 9.15, 2.41, 5.37 at 2026-10-16T08:35Z; investorgain 82, 6.9, 9.4, 2.5, 5.4 at 08:50Z; ipowatch 80, 6.7, 9.0, 2.4, 5.3 at 08:40Z. The newest fixture point is investorgain (08:50Z)"
  - "Fixtures: apps/worker/fixtures/portal_*.html (4 IPO rows, a Jio Financial decoy, 3-4 news anchors); test pages src/adapters/__fixtures__/portal/{no-issuer,drifted,js-rendered}.html"
affects: [04-01, 05-02, 07-01]
key_files:
  - apps/worker/src/adapters/portal-shared.ts
  - apps/worker/src/adapters/portal-chittorgarh.ts
  - apps/worker/src/adapters/portal-investorgain.ts
  - apps/worker/src/adapters/portal-ipowatch.ts
  - apps/worker/src/adapters/portal-adapters.test.ts
  - apps/worker/src/adapters/portal-runner.test.ts
key_decisions:
  - "Market point observedAt is the page's own 'Last Updated' time (IST), falling back to now: a stale page never writes duplicate points, so repeat fixture runs add 0 market points (the plan expected 5 more per run)"
  - "Header-driven table lookup (by header text, first row th or td), no CSS selectors; per-portal overrides only for header labels"
issues_created: [ISS-TBD-1, ISS-TBD-2]
completed: 2026-10-16
---

# 02-04: Portal adapters

**Cheerio parsers for Chittorgarh, InvestorGain and IPOWatch that turn GMP and subscription tables into five Jio Platforms market series plus portal news posts, with layout drift raising SourceParseError so the circuit opens instead of writing a bad number.**

## Accomplishments

- Shared header-driven helpers (42 tests) and three portal adapters (31 tests) with realistic fixtures that include a Jio Financial decoy never read.
- End-to-end runner tests: 5 fixture points per portal (15 in all), media-lane fixture posts, fetch_run with cost 0, and three drifted live runs open the breaker.
- `SOURCES_MODE=fixture ... index.ts --once` prints the three portal rows with status ok.

## Task commits

1. Task 1: Shared header-driven table parsing helpers - `be711ac` (feat)
2. Task 2: Chittorgarh, InvestorGain and IPOWatch adapters with HTML fixtures - `23fe8a0` (feat)
3. Task 3: Portal fixtures end to end through the runner - `1ff60df` (test)
4. Deviation: update 02-01 portal stub expectations - see git log (test)
5. Metadata - docs(02-04): complete plan

## Decisions

- observedAt comes from the page, so identical re-fetches dedupe on (series, source, observed_at); the market strip only gets new points when the portal updates.
- Header overrides try the override first, then the defaults.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] fixtures.test.ts asserted the portal stubs** (live NotConfiguredError, empty fixture result, 'Retail' header) - found in Task 2; fix: excluded portals from the stub test, expect 5 points, accept Retail or RII; verified by: fixtures.test.ts portal cases pass; file belongs to 02-01.
- **Plan conflict**: Task 3 expected 5 more points on a second run; the unique key on observed_at makes that impossible with page time, so the test asserts 0 (see decisions).
- STATE.md, ISSUES.md, DECISIONS.md not edited per orchestrator instruction.

### Deferred to ISSUES.md
- ISS-TBD-1: verify portal URLs, JS rendering and ToS before enabling live portals (InvestorGain sometimes serves JS-only pages; these raise SourceParseError). (Task 2)
- ISS-TBD-2: fixture market points are static, so the market strip never moves in fixture mode; 07-01's demo builds history. (Task 3)

## Verification

- Tests: portal-shared 42, portal-adapters 31, portal-runner 10 pass; fixtures.test.ts portal cases pass. Full worker suite still has failures in other plans' in-progress files (reddit, x-apify, news_rss/web_search stub test), none in portal code.
- Types / lint / prettier: no errors in portal files (workspace typecheck has errors from other plans' unfinished files).

## Next-phase readiness

- Market strip (04-01) can read portal_* market_points; fixture rows have source_url ending `#fixture`.
- Sources page (05-02) shows breaker open after 3 drift errors.
