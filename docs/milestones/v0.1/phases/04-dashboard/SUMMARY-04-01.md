---
phase: 04-dashboard
plan: 01
requires:
  - { phase: 00-foundation, provides: [web db singleton getDb (lib/db.ts), Vitest config, '@/ alias'] }
  - { phase: 01-data-and-login, provides: [api-types skeleton, AppConfig (min_items_for_split, active_min_items_24h, sources.*.interval_min/market_hours_interval_min/coverage_label), schema + effective_classifications view, getLatestConfig, sourceHealth, prepareTestDb/connectTestDb, auth (lib/auth.ts)] }
  - { phase: 03-classification, provides: [sparse topic_stats_15m rollups bucketed on posts.published_at with literal 'all' entity/lane rows, emerging topics (kind 'emerging', slugs emerging-*), topics.summary_2line] }
provides:
  - "@jio/core api-types: Trend, SplitCounts, TopicRow, BriefKpis, MarketStripItem, MarketStrip, SourceFreshness, BriefResponse, HourPoint, MarketSeriesPoints, TimelineTopic, TimelineResponse, EvidenceAuthor, EvidenceItem, EvidencePage, ApiErrorBody, plus TRENDS, FRESHNESS_STATUSES, EVIDENCE_SORTS, EVIDENCE_WINDOWS, RESERVED_TOPIC_SLUGS, VISIBLE_AUTHOR_KINDS"
  - "GET /api/brief?entity=&lane= (cached 15s per filter), GET /api/topics/:slug/timeline?entity=&lane= (cached 15s, 404 not_found), GET /api/evidence (no-store); 401 unauthorized, 400 bad_request {issues}, 503 db_unavailable"
  - "Evidence params beyond the contract: from/to (both or neither, <= 7d), source, confidence=low, sort reach|newest, limit 1-50 (default 20), reserved topic=emerging|unclassified; EvidencePage.total"
  - "lib/api.ts: ApiError, fetchJson, getBrief, getTimeline, getEvidence, queryKeys, Filters, EvidenceQuery (browser-safe)"
  - "lib/queries: readCtx/ReadCtx, getBrief, getTopicMeta, getTimeline, getEvidence, withApi/apiError, memo/clearMemo, parseParams + BriefParams/TimelineParams/EvidenceParams/SLUG_RE, ParamError, encodeCursor/decodeCursor, toEvidenceAuthor/authorLabel, ranking (trendOf, rankScore, rankTopics, isActive, splitShown, lowConfPct), window (floor15, windowRanges, range7d, floorIstHour, istHours, IST_HOUR_ORIGIN), freshnessOf/effectiveIntervalMin, test-fixtures resetAndSeed"
affects: [04-02, 04-03, 05-operator-pages, 06-trust-layer, 07-hardening, web]
key_files:
  - packages/core/src/api-types.ts
  - apps/web/src/lib/api.ts
  - apps/web/src/lib/queries/brief.ts
  - apps/web/src/lib/queries/timeline.ts
  - apps/web/src/lib/queries/evidence.ts
  - apps/web/src/lib/queries/http.ts
  - apps/web/src/lib/queries/params.ts
  - apps/web/src/lib/queries/test-fixtures.ts
  - apps/web/src/app/api/brief/route.ts
  - apps/web/src/app/api/topics/[slug]/timeline/route.ts
  - apps/web/src/app/api/evidence/route.ts
key_decisions:
  - "apps/web uses zod ^4.6.7, not zod@3: adding zod 3 pushed better-call's zod ^4 peer down to 3.25"
  - "Each integration test file has its own DB (jio_ipo_test_web_brief/_timeline/_evidence), so parallel truncates never collide"
  - "Evidence responses are no-store; brief and timeline are private, max-age=15"
  - "Active and split rules apply to the selected entity/lane slice"
  - "Market strip age = since the newer of observedAt and the source's last ok fetch; stale = the source's freshness is not ok"
issues_created: []
completed: 2026-10-16
---

# 04-01: Dashboard read API

**The board's three session-guarded read endpoints: /api/brief (KPIs, active seed topics ranked by sqrt(items x unique authors) x clamped velocity, Emerging/Unclassified counts, market strip, per-source freshness), /api/topics/:slug/timeline (168 IST hours, market series, by-source and by-entity splits) and /api/evidence (keyset-paged posts that show authors only for media outlets and public figures). Response types live in @jio/core and lib/api.ts is the typed browser client.**

## Accomplishments

- Windows are bucket-aligned: cur is the 96 buckets ending with the current one, prev is the 96 before them, and the timeline covers 168 IST hours that start at :30 UTC. KPIs sum every topic. The topic table holds only seed topics that are not dismissed, have at least `active_min_items_24h` items in the slice, and are ranked by score, then items, then name. `splitShown` is false under `min_items_for_split` for KPIs, topic rows, bySource and byEntity.
- Unique authors are counted as distinct `coalesce(author_id, 'post:'||id)` over posts joined to effective_classifications. Trend is new/up/down/flat, with ±10% thresholds and deltaPct to 1 dp.
- Author privacy is enforced twice. The evidence SQL selects handle and display_name only through `CASE WHEN a.kind IN ('media_outlet','public_figure')`, and never selects author ids, platform ids, followers or raw_json. `toEvidenceAuthor` then maps every other author to a platform label ('Reddit user', 'IPO portal', ...).
- Evidence uses keyset paging (reach desc, published_at desc, id desc, or newest). Cursors are base64url JSON with microsecond timestamps. Twenty-five rows with tied reach and tied times page 10/10/5 with no duplicates or gaps.
- `withApi` checks the session first (401, or 503 if the session lookup fails), turns a ParamError into 400 with issues and any other error into 503 `{error:'db_unavailable'}` (the detail goes only to the server log), and sets Cache-Control. `memo` shares one in-flight promise per key, never caches a rejection and holds at most 200 keys.

## Task commits

1. Task 1: API response types and pure read-layer helpers - `2637641` (feat)
2. Task 2: SQL readers for brief, timeline and evidence - `a79ce9c` (feat)
3. Task 3: Route handlers and typed browser client - `25d7a31` (feat)

## Decisions

- **zod 4 in web:** `zod@^3.23` re-resolved better-call's zod ^4 peer to 3.25.76 and pnpm warned that the peer was unmet. `zod@^4.6.7` is the version already in the lockfile, so the lockfile change is only the new importer entry. Web param schemas use the zod 4 API, and @jio/core stays on zod 3.
- **Per-file test databases:** `prepareTestDb('jio_ipo_test_web_<brief|timeline|evidence>')`, because these tests truncate tables and Vitest runs files in parallel.
- **Evidence Cache-Control:** no-store. The plan's default `private, max-age=15` would let a browser show a stale page after a relabel.
- **Active and split rules per slice:** they use the filtered entity/lane rollup rows. The worker's `topics.status` uses all/all.
- **Freshness:** waiting when there has been no ok run; stale when the age is more than twice the effective interval or there have been 3 or more failures in a row. The market-hours interval applies during `isIndianMarketHours(now)`. Only enabled sources are listed. A market item's ageMin counts from the newer of observedAt and the source's last success, and `stale` means that source's status is not ok.
- **Emerging counts:** `emerging.candidates` leaves out the generic slug 'emerging' and dismissed topics.
- **Cursor validation:** the cursor is checked inside EvidenceParams, so a bad cursor or a sort mismatch gives 400 before any query runs. A failed getSession returns 503.
- **Timeline filters:** TimelineTopic.items24h and lastItemAt honour the entity/lane filter. byEntity ignores the entity filter but honours lane.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] zod@3 broke the better-call peer resolution.** Found in Task 1. Fix: zod ^4.6.7 instead. Verified by a clean lockfile diff and by the auth tests, build and signed-in smoke test. Commit `2637641`.
- **[Rule 2 - structure] ParamError in its own file.** Added `apps/web/src/lib/queries/errors.ts` (inside the owned glob) so params.ts and cursor.ts do not import each other. Commit `2637641`.

### Deferred (for ISSUES.md)
- The evidence route has no 'suspected coordinated only' filter, because there is no per-post coordination flag yet (06). (Task 2)
- The KPIs give count-based sentiment, not the reach-weighted headline, because the rollup reach columns are a placeholder until 06. (Task 2)
- The brief has no gold-set accuracy figure for the footer (05/06). (Task 2)
- Evidence `total` is count(*) over the whole slice and may need a cap at scale. (Task 2)
- emerging.count includes items in dismissed emerging topics. (Task 2)
- The memo is per process. (Task 3)

## Verification

- Tests: `corepack pnpm test` -> core 122, db 51, worker 531, web 162 (17 files) and node:test 14 passed, 0 failed. The new tests: helpers 48, brief 15, timeline 8, evidence 9, http 7, routes 26, api client 7, core api-types 5.
- TDD: each task showed RED first. Task 1: missing constants and modules. Task 2: "Failed to load url ./brief | ./timeline | ./evidence". Task 3: "Failed to load url ./http | ./route | ./api".
- Build / types / lint: `corepack pnpm typecheck` PASS, `corepack pnpm lint` PASS, `corepack pnpm --filter @jio/web build` PASS (it lists /api/brief, /api/evidence and /api/topics/[slug]/timeline), and `prettier --check` on the owned paths PASS.
- Smoke check against `next start` on 3100: /api/brief, /api/topics/valuation-price-band/timeline and /api/evidence return 401 with no cookie and with a bogus cookie. After signing in with the seed user they return 200, with `private, max-age=15` on brief and timeline and `no-store` on evidence. `entity=anant` and `window=30d` give 400 and an unknown slug gives 404. The server was stopped afterwards.
- grep: in the readers, `handle` appears only in the evidence CASE expression, its row type and the mapper (privacy.ts).

## Next-phase readiness

- 04-02/04-03: use `getBrief/getTimeline/getEvidence` and `queryKeys` from `@/lib/api`. The UI only has to turn pos/neu/neg counts into percentages and honour `splitShown`. TopicRow.spark has 24 IST-hour counts, oldest first. TimelineResponse.series has 168 HourPoints and market has all 5 series (they may be empty).
- 05: `freshnessOf/effectiveIntervalMin` in lib/queries/brief.ts can feed the Sources page. `withApi` takes `{cacheControl}`, and handlers may return a Response (for example `apiError(404, 'not_found')`).
- Route tests mock `@/lib/auth`, `@/lib/queries/ctx` and the query module, call `clearMemo()`, and invoke `GET(req, ctx)` with two arguments.
- Raw SQL on the shared client: pass ISO strings with `::timestamptz` and read timestamps as epoch ms. drizzle disables timestamp parsing on the client.
