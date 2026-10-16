---
phase: 06-trust-layer
plan: 01
requires:
  - { phase: 01-data-and-login, provides: "posts.reach_score/reach_raw/lane, authors.followers, topic_stats_15m reach_pos/neu/neg, prepareTestDb/connectTestDb/truncateAll" }
  - { phase: 03-classification, provides: "rollup/index.ts recomputeRange + runRollup (placeholder reach sum), effective_classifications fan-out" }
  - { phase: 04-dashboard, provides: "getBrief/getTimeline readers, BriefParams/TimelineParams lane param, test-fixtures resetAndSeed, FilterBar children slot, KpiRow, TopicsTable, queryKeys keyed on lane" }
provides:
  - "trust/config.ts: zod TrustConfig/ReachConfig/CoordinationConfig, TRUST_DEFAULTS (reach + coordination), resolveTrustConfig(appConfig)"
  - "trust/reach.ts: mainMetric, percentile, computeReachScore, p95LogBySource, shouldFullRescore, refreshReachScores(h, now, cfg, {full}), lastFullRescoreAt, cachedP95Log, resetReachCache"
  - "rollup: reach_* = sum(coalesce(reach_score, unknownScore)) per sentiment; runRollup refreshes reach scores first; recomputeReachColumns(h, {from,to}, {unknownScore?}); RollupResult.reach"
  - "@jio/core api-types: ReachSplit, BriefKpis.reach, TopicRow.reach, BriefResponse.lane, TimelineResponse.lane (additive)"
  - "lib/queries/ranking.ts: percentSplit (largest remainder), reachSplit(reach, items, min)"
  - "components/brief/lane-toggle.tsx: LANE_OPTIONS, parseLane, laneHref, LaneToggle (named + default)"
  - "components/brief/reach-split.tsx: formatSplit, ReachSplitView({reach, raw, n, onOpen?})"
affects: [06-02, 07-hardening, rollup, brief, topic page, filters]
key_files:
  - apps/worker/src/trust/config.ts
  - apps/worker/src/trust/reach.ts
  - apps/worker/src/trust/reach.int.test.ts
  - apps/worker/src/rollup/index.ts
  - apps/worker/src/rollup/reach.int.test.ts
  - apps/worker/src/rollup/rollup.int.test.ts
  - packages/core/src/api-types.ts
  - packages/core/src/api-types.test.ts
  - apps/web/src/lib/queries/ranking.ts
  - apps/web/src/lib/queries/brief.ts
  - apps/web/src/lib/queries/timeline.ts
  - apps/web/src/lib/queries/test-fixtures.ts
  - apps/web/src/components/brief/lane-toggle.tsx
  - apps/web/src/components/brief/reach-split.tsx
  - apps/web/src/components/brief/kpi-row.tsx
  - apps/web/src/components/brief/topics-table.tsx
  - apps/web/src/components/brief/brief.test.tsx
  - apps/web/src/components/shell/filter-bar.tsx
key_decisions:
  - "LaneToggle is mounted inside the shared FilterBar (shell/filter-bar.tsx, the real 04-02 file), so the brief and /topics/[slug] both get it without editing page.tsx or topic-view.tsx"
  - "refreshReachScores takes the rollup handle {sql}: it runs raw postgres-js SQL like recomputeRange"
  - "Full reach pass: p95 from in-window social rows; it rescores in-window rows plus any older NULL row; writes skip unchanged scores"
  - "recomputeReachColumns runs after a full rescore only in 'recent' runs; a full7d run already recomputes the same window"
  - "Reach split helpers live in lib/queries/ranking.ts (no percent helper existed in lib/queries)"
issues_created: [trust-config-stripped-by-AppConfig, reach-cache-per-process, null-reach-scan-no-index, youtube-comments-unknown-reach, hourly-reach-column-rewrite, topic-page-no-reach-split]
completed: 2026-10-16
---

# 06-01: Reach-weighted sentiment and lane toggle

**Every post now gets a per-source normalized reach_score in [0.05, 1]. Media posts get exactly 0.6 and a missing metric 0.25; every other score is log10(1+metric) divided by that source's p95, capped at 1. The 15-minute rollups carry reach-weighted pos/neu/neg sums. /api/brief returns integer reach-weighted splits for the KPIs and each topic (null under 30 items) and echoes the lane it applied. The brief headline shows the reach-weighted split with the raw split and n beside it, and an All / Social / Media and analyst toggle in the shared filter bar rewrites `lane` and keeps every other URL param.**

## Accomplishments

- `TRUST_DEFAULTS` (reach and coordination blocks) and `resolveTrustConfig`, which deep-merges an optional `appConfig.trust` over the defaults and falls back to them when the result does not parse.
- The reach functions are pure: mainMetric picks followers for X and LinkedIn (falling back to authors.followers), views for YouTube, upvotes for Reddit and likes for Instagram. The others are percentile (linear interpolation), computeReachScore and p95LogBySource (at least 20 social samples, otherwise the source default, otherwise 4).
- `refreshReachScores`: a full pass, cached with its time, every 60 minutes; otherwise only NULL rows are scored with the cached p95. Writes use `UPDATE ... FROM (VALUES ...)` in chunks of 500.
- `runRollup` refreshes reach scores before recomputing any bucket and coalesces a NULL score to unknownScore in SQL. After a full rescore, `recomputeReachColumns` rewrites only the reach columns of the last 7 days. Counts and coordination columns are untouched.
- In the read API, kpis.reach and TopicRow.reach come from sum(reach_*) over the 96 buckets of the requested lane's own rows, so lane=all never sums the lane rows. They are null under min_items_for_split or when the reach sum is 0. BriefResponse and TimelineResponse echo `lane`.
- In the UI, LaneToggle (a shadcn ToggleGroup with aria-label "Lane") uses `router.replace(laneHref(...), {scroll:false})`. ReachSplitView draws a stacked bar with whole percents (each one opens evidence) and "Raw a / b / c, n = N", or "Not enough data (n=X)". The topics table gains a Reach-weighted column.

## Task commits

1. Task 1: Reach scoring and trust defaults - `0c51bbe` (feat)
2. Task 2: Reach-weighted sentiment in rollups - `ec2a2cf` (feat)
3. Task 3: Reach fields and lane filtering in the read API - `fe8cd14` (feat)
4. Task 4: Lane toggle and reach-weighted headline on brief and topic pages - `182a43c` (feat)

## Decisions

- `refreshReachScores(h: {sql}, now, cfg: ReachConfig, {full})` takes the rollup handle, not a drizzle db.
- A full pass also scores NULL rows older than lookbackDays; only in-window rows feed the p95. Unchanged scores are not rewritten (`is distinct from`).
- `recomputeRange` and `recomputeReachColumns` accept `{unknownScore}` and default to TRUST_DEFAULTS.reach.unknownScore.
- A full7d run skips recomputeReachColumns because it already recomputes the same 7-day window.
- percentSplit and reachSplit live in `lib/queries/ranking.ts`.
- LaneToggle lives in FilterBar itself, the real 04-02 filter bar at `components/shell/filter-bar.tsx`. The topic page reuses that FilterBar, and its back link already keeps `lane` (04-03 backHref).
- KPI Sentiment: ReachSplitView replaces the raw-percent buttons. The reach percents open evidence, and the raw split is shown as text beside them.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] Additive required fields broke typecheck in test fixtures outside the declared files.** `packages/core/src/api-types.test.ts` and `apps/web/src/components/brief/brief.test.tsx` construct BriefResponse and TopicRow objects. Only the new fields were added to those fixtures. Verified by `corepack pnpm typecheck`. Commit `fe8cd14`.
- **[Rule 3] Real mount paths differ from the plan's guesses.** The filter bar is `components/shell/filter-bar.tsx`, not `components/brief/filter-bar.tsx`. Mounting there covers both pages, so `app/(app)/page.tsx` and `components/topic/topic-view.tsx` were not edited. Commit `182a43c`.
- **[Rule 1] The existing rollup test expected the placeholder reach (2.5).** `runRollup` now rescores reach first, so the expectation is the unknown score 0.25, and the test file resets the reach cache in beforeEach. Commit `ec2a2cf`.
- `lib/queries/test-fixtures.ts` derives reach_* from each post's reachScore (NULL -> 0.25), and StatSpec gained reachPos/reachNeu/reachNeg. Commit `fe8cd14`.
- The route zod params already accepted `lane` ∈ {all, social, media} with default 'all', and existing helper tests cover it, so no route file was touched.
- STATE.md, ISSUES.md, DECISIONS.md and this SUMMARY were not written by the implementer (orchestrator rule).

### Deferred to ISSUES.md
- Trust overrides can never apply: AppConfig strips an unknown `trust` key, so resolveTrustConfig always yields the defaults (Task 2)
- The reach p95 cache is per process; a restart triggers a full rescore on the first rollup (Task 1)
- The incremental pass scans `reach_score IS NULL` every minute with no partial index (Task 1)
- YouTube comments have no views metric, so they get 0.25; Instagram uses likes even when views exist (Task 1)
- recomputeReachColumns rewrites 7 days hourly even when no score changed (Task 2)
- The topic page has the lane toggle but shows no reach-weighted split (Task 4)
- No code-reviewer subagent was available; a self-review was done instead

## Verification

- TDD RED evidence:
  - Task 1: "Failed to load url ./config", then 31 tests passed.
  - Task 2: (d), the runRollup NULL check, recomputeReachColumns and the stale-bucket test failed on their assertions or "is not a function". (a) to (c) already held with the 03-03 placeholder sum and now act as regression guards.
  - Task 3: 8 tests failed: lane undefined, reach undefined, "reachSplit is not a function".
  - Task 4: "Failed to load url ./lane-toggle".
- Tests: `bash scripts/pnpm-locked.sh test` -> core 122, db 51, worker 569 (44 files), web 402 (37 files), node:test 14. All pass, 0 failed.
- `corepack pnpm typecheck` PASS (all 4 packages). `corepack pnpm lint` (eslint . --max-warnings=0) PASS. `corepack pnpm --filter @jio/web build` PASS. Prettier was run on the owned paths.
- After a full refresh, the integration tests show no NULL reach_score, every score in [0.05, 1], and media posts at exactly 0.6. After runRollup, there are 0 topic_stats_15m rows with items > 0 and a reach sum of 0.
- No author handle, author id or followers field was added to any web result type. The new fields are ReachSplit, reach and lane.

## Next-phase readiness

- 06-02: `TRUST_DEFAULTS.coordination` and `resolveTrustConfig` are in `apps/worker/src/trust/config.ts`. The rollup upsert still preserves the coordination columns. Rollup tests must call `resetReachCache()`.
- 07-hardening: `RollupResult.reach {updated, full}` can be logged. Consider persisting the p95 cache or adding a partial index on `posts (id) where reach_score is null`.
- FilterBar now always renders LaneToggle (two 'All' radios on the page).
