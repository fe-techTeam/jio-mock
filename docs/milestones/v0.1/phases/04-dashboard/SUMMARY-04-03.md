---
phase: 04-dashboard
plan: 03
requires:
  - { phase: 04-dashboard, provides: [TimelineResponse, getTimeline/getEvidence client fns, queryKeys, getTopicMeta, useFilters, useOpenEvidence, EvidenceSlice, EvidenceCard, StaleBanner, FilterBar, formatIst, pctSplit, shadcn chart] }
provides:
  - "Topic detail page /topics/[slug] with slug validation, not-found page and metadata title"
  - "chart-data helpers: toChartRows, bucketSlice, dormantText, backHref, marketLatest"
  - "TopicView: header, FilterBar, 7-day hourly stacked sentiment chart with market line on a second axis, by-source and by-entity breakdowns, top 10 posts"
affects: [06-01 lane toggle, 06-02 coordination panel, 07-hardening]
key_files:
  - apps/web/src/app/(app)/topics/[slug]/page.tsx
  - apps/web/src/app/(app)/topics/[slug]/not-found.tsx
  - apps/web/src/components/topic/chart-data.ts
  - apps/web/src/components/topic/topic-view.tsx
  - apps/web/src/components/topic/timeline-chart.tsx
  - apps/web/src/components/topic/by-source-table.tsx
  - apps/web/src/components/topic/entity-breakdown.tsx
  - apps/web/src/components/topic/top-posts.tsx
  - apps/web/src/components/topic/topic-header.tsx
  - apps/web/src/components/topic/topic-skeleton.tsx
key_decisions:
  - "Market points map to IST hour windows [hourStart, +1h); last point wins; no carry-forward"
  - "Bar onClick on all three stacked bars, exported as makeBarClick for tests"
  - "SplitCell shared between source and entity tables, one text node"
issues_created: [ISS-A, ISS-B, ISS-C, ISS-D, ISS-E]
completed: 2026-10-16
---

# 04-03: Topic detail page

**Topic detail at /topics/[slug] with a 168-hour stacked sentiment chart plus GMP or subscription line on a second axis, source and entity breakdowns under the 30-item rule, top-10 posts, and every number opening the evidence drawer.**

## Accomplishments

- Server page validates the slug (`^[a-z0-9-]{1,64}$`) and checks `getTopicMeta`; bad or unknown slugs render the not-found page with a link back to the brief.
- Chart rows keep all 168 IST hours; the selected market series (GMP, Total, Retail, NII, QIB) is placed by IST hour with a freshness badge ("GMP 12 min old - unofficial" or "No market data").
- Bars, by-source items, entity counts, top posts and "Open all in drawer" open the shared drawer with the matching slice; back link keeps `entity` and `lane`.
- Breakdowns under 30 items show "Not enough data (n=X)"; author handles are never shown unless the API marks them visible.

## Task commits

1. Task 1: Route, not-found page and chart data shaping - `e34ffcd` (feat)
2. Task 2: Topic view with timeline chart, breakdowns and top posts - `832e560` (feat)
3. Task 3: Full gate and route smoke check - `bea7030` (test)

## Decisions

- Market point to hour matching uses the IST-aligned hour windows (:30 UTC starts); the later point wins.
- Chart colours are literal hex values in the chart config.
- Entity breakdown always renders four rows, zero-filled.
- Commit `e34ffcd` alone does not typecheck (page imports files from the next commit); HEAD does.

## Deviations from plan

None to the code scope. Per harness instructions SUMMARY, STATE and PROGRESS were not written by the implementer; the orchestrator merges them.

### Auto-fixed
- **[Rule 1 - test fixture]** Test series started on 2026-10-09 so did not contain the 16 Oct hour under test; moved start to 2026-10-10T03:30Z - found in Task 1; verified by chart-data tests.
- **[Rule 1 - testability]** Split text rendered across spans was not matchable as one string; collapsed to a single text node - found in Task 2.

### Deferred to ISSUES.md
- ISS-A: zero-item hours are unclickable (Bar onClick only) (Task 2)
- ISS-B: getTopicMeta runs twice per request (Task 1)
- ISS-C: drawer mounting is inherited from the (app) layout, only verified by 200 response (Task 3)
- ISS-D: reserved topics (emerging, unclassified) use the generic path (Task 1)
- ISS-E: seed inserted 0 topics (already present); smoke ran on an empty-data timeline (Task 3)

## Verification

- Tests: `corepack pnpm test` -> core 122, db 51, worker 531, web 223 passed (topic: 20 across 3 files), 0 failed
- Build / types / lint: `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm --filter @jio/web build` all PASS
- Smoke (signed in as seed user, dev server on 3100): `/topics/valuation-price-band` 200, `/topics/does-not-exist` 404, `/topics/BAD_SLUG!` 404, timeline API `series.length` 168

## Next-phase readiness

- 06-01: pass the lane toggle as children of `FilterBar` in `topic-view.tsx`.
- 06-02: mount the coordination panel between `TimelineChart` and the breakdown grid in `TopicView`.
- No blockers.
