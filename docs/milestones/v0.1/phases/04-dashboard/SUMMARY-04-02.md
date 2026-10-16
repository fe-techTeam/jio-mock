---
phase: 04-dashboard
plan: 02
requires:
  - { phase: 04-dashboard, provides: [BriefResponse/EvidencePage types, lib/api.ts getBrief/getEvidence/queryKeys/ApiError/Filters/EvidenceQuery, /api/brief and /api/evidence routes] }
  - { phase: 01-data-and-login, provides: [requireSession (redirect + view event), authClient, SignOutButton, login page reason=expired alert] }
  - { phase: 00-foundation, provides: [Next 15 web app, shadcn new-york setup, Vitest jsdom for .tsx] }
provides:
  - "Providers (components/providers.tsx): one QueryClient per mount, refetchInterval 30s, keepPreviousData, staleTime 15s, retry 1, focus refetch; a 401 goes to /login?reason=expired&next=..; sonner Toaster; TooltipProvider. createQueryClient/expiredLoginUrl exported"
  - "Shell: useFilters/parseFilters/hrefWith (URL entity+lane, setFilter keeps other params), Header (Private badge, FreshnessPill sharing the brief query, Sources/Settings/Accuracy, sign out), FilterBar ('Mentions' entity toggle, children slot for the lane toggle), StaleBanner"
  - "Format helpers (shell/format.ts): formatIst, formatIstRange, pctSplit (largest remainder), formatAge, formatCount (en-IN), formatDeltaPct, safeExternalUrl"
  - "Evidence: EvidenceSlice + encodeSlice/decodeSlice/normalizeSlice/toEvidenceParams/describeSlice (slice.ts), useOpenEvidence/useCloseEvidence/useEvidenceSlice, EvidenceDrawer (mounted once in (app)/layout.tsx), EvidenceCard (exported for 04-03 top posts), SourceBadge/sourceLabel, RelabelControls stub for 05-03"
  - "Executive brief at /: BriefView (skeleton, collecting, stale banner, error+retry), KpiRow, TopicsTable, SentimentBar (+SENTIMENT_STYLE, NotEnoughData), TrendArrow, Sparkline, MarketStrip, BucketCounts, BriefFooter"
  - "shadcn ui: sheet, table, toggle, toggle-group, skeleton, tooltip, select, sonner, chart (recharts 3)"
  - "Test helpers: components/shell/test-utils.tsx (next/navigation mock state, renderWithClient, makeTestClient, replacedParams)"
affects: [04-03, 05-01, 05-02, 05-03, 06-01, 06-02, 07-hardening, web, evidence, filters]
key_files:
  - apps/web/src/components/providers.tsx
  - apps/web/src/components/shell/use-filters.ts
  - apps/web/src/components/shell/format.ts
  - apps/web/src/components/shell/header.tsx
  - apps/web/src/components/shell/test-utils.tsx
  - apps/web/src/components/evidence/slice.ts
  - apps/web/src/components/evidence/use-open-evidence.ts
  - apps/web/src/components/evidence/evidence-drawer.tsx
  - apps/web/src/components/evidence/evidence-card.tsx
  - apps/web/src/components/evidence/relabel.tsx
  - apps/web/src/components/brief/brief-view.tsx
  - apps/web/src/components/brief/sentiment-bar.tsx
  - apps/web/src/app/(app)/layout.tsx
  - apps/web/src/app/(app)/page.tsx
key_decisions:
  - "shadcn components hand-written on per-package @radix-ui deps: the CLI emits imports from the cn and radix-ui packages (see 00-02, 01-03)"
  - "jsdom ^30 -> ^25: jsdom 30's undici 8 crashes under Node 22.12, so no jsdom test could run"
  - "401 -> /login?reason=expired&next=<path>: matches the login page's existing alert param"
  - "Evidence infinite query: placeholderData undefined (no stale posts from another slice), no polling"
  - "safeExternalUrl guards every data-built link (http/https only)"
issues_created: []
completed: 2026-10-16
---

# 04-02: Executive brief and evidence drawer

**An executive brief at `/` that polls /api/brief every 30s: KPI row, ranked talking points with sentiment bars, trend arrows and sparklines, market strip, and Emerging/Unclassified counts. Every number opens a URL-driven evidence drawer with infinite "Load more". The entity filter lives in the URL, every time is shown in IST, and the last good data stays on screen under an amber banner when a poll fails.**

## Accomplishments

- One QueryClient provider with the contract defaults. A 401 from any query sends the user to the login page's "Session expired" alert and then back to where they were.
- `entity` lives in the URL through `useFilters`. `setFilter` keeps `lane` and `evidence`, and reloading keeps the filter. The query key changes with the filter.
- The evidence drawer opens on any (app) page from a valid `evidence` param and closes by removing only that param. It shows the slice description and total, Reach/Newest sort, skeletons, an empty state, an inline retry and Load more with the returned cursor. Author names appear only when the API marks them visible; otherwise the card shows "Reddit user"-style labels. Text is always rendered as plain text.
- On the brief, the KPI items, each sentiment %, the change, low-confidence %, every topic volume, segment and low-confidence % and the Emerging/Unclassified counts are all buttons that write `evidence`. Coordination counts are plain numbers until 06-02. Any slice under 30 items shows "Not enough data (n=X)".
- A failed poll keeps the data on screen under "Could not refresh, showing data as of HH:MM IST" with a Retry button. A failed first load shows an error card with Retry.

## Task commits

1. Task 1: Providers, URL filters, formatting helpers and app shell - `458944e` (feat)
2. Task 2: Evidence drawer opened from a URL slice - `82066bd` (feat)
3. Task 3: Executive brief page with KPI row, topics table and market strip - `03ff85f` (feat)

## Decisions

- shadcn components were hand-written (new-york) on `@radix-ui/react-dialog`, `-select`, `-toggle`, `-toggle-group` and `-tooltip`. `sonner` drops next-themes and uses theme="system". `chart` is typed for recharts 3.
- The header reuses `components/auth/sign-out-button.tsx` from 01-03.
- `decodeSlice` returns null for any bad value, ignores unknown keys and defaults window to 24h and sort to reach. `toEvidenceParams` lets `slice.entity` override the page filter. Lane always comes from the page.
- "Change vs prior 24h" opens the 7d window. The KPI trend uses the same 10% rule as the API's `trendOf`, duplicated locally so that components never import `lib/queries`.
- `FilterBar` takes `children` so 06-01 can add the lane toggle without restructuring it.
- Shared test helpers are in `components/shell/test-utils.tsx`. They are used with `vi.mock('next/navigation', () => import('@/components/shell/test-utils'))`.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] jsdom 30 (from 00-02) crashes Vitest under Node 22.12 (undici 8 `reading 'bind'`)**: found in Task 1. Fixed by switching to `jsdom@^25` as the plan listed. Verified by all jsdom suites running. Commit `458944e`.
- **[Rule 3] shadcn CLI not used**: done in Task 1. The components were hand-written to avoid the CLI's cn and radix-ui imports. Verified by typecheck, build and the component tests. Commit `458944e`.
- **[Rule 2 - security] Links built from data could carry `javascript:` URLs**: found in Task 3. Added `safeExternalUrl` and applied it to EvidenceCard and MarketStrip. Verified by tests. Commit `03ff85f`.
- The placeholder `apps/web/src/app/page.tsx` was already gone (01-03), so there was nothing to delete. `(app)/page.tsx` replaces the 01-03 placeholder content.
- 401 param: `reason=expired` (the actual 01-03 param), not `expired=1`.
- STATE.md and the SUMMARY file were not written by this implementer: the orchestrator merges them.

### Deferred to ISSUES.md
- `apps/web/scripts/smoke-login.sh` still greps the SSR HTML of `/` for "Collecting", which is now client-rendered. It should grep for "Executive brief" or "Mentions" (found in Task 3).
- `posts.reach_score` is never computed, so Reach shows "-" and reach sort falls back to newest. The scale is also undefined; the UI assumes 0-100 (found in Task 2).
- globals.css is missing `--card`, `--popover` and `--chart-*` tokens (found in Task 1).
- The header polls `/api/brief` on every (app) page just for the freshness pill. A lighter freshness endpoint could replace that (found in Task 1).
- No dark-mode switch exists (`.dark` is never applied) (found in Task 3).
- The final code-reviewer subagent was not run because no Agent tool was available. A self-review was done instead.

## Verification

- Tests: `corepack pnpm --filter @jio/web test` -> 20 files, 203 passed (new: shell 15, evidence 13, brief 14)
- TDD: each suite failed first on the missing module (compile-time RED), then passed. The URL-safety tests failed on the assertion first (runtime RED).
- Types / lint / build: `corepack pnpm typecheck` PASS, `corepack pnpm lint` PASS, `corepack pnpm --filter @jio/web build` PASS (one `/` route, 7.81 kB), prettier --check on my paths PASS
- `grep -rn dangerouslySetInnerHTML apps/web/src/components` -> nothing. No component imports `@jio/db`, `@/lib/db` or `@/lib/auth`.
- Manual smoke on `next start -p 3199` with the seeded user: GET `/?entity=isha&evidence=...` -> 200 with header, "Mentions" and the brief skeleton. `/api/brief` returns fixture market points.

## Next-phase readiness

- 04-03: use `EvidenceCard`, `useOpenEvidence` (from/to/source/entity slices), `SENTIMENT_STYLE`, `NotEnoughData`, `StaleBanner`, `FilterBar` and `formatIst(…, 'datetime')`. `components/ui/chart.tsx` and recharts 3 are installed.
- 05-03: replace only `components/evidence/relabel.tsx` (`RelabelControls({item})`). The Toaster is already mounted in Providers.
- 06-01: render `LaneToggle` as a child of `<FilterBar>`. `useFilters().setFilter('lane', …)` already keeps the other params.
- 06-02: make the coordinated counts in `kpi-row.tsx` and `topics-table.tsx` clickable.
- Concern: smoke-login.sh will fail its "Collecting" grep until it is updated (see deferred).
