---
phase: 03-classification
plan: 03
requires:
  - { phase: 01-data-and-login, provides: "schema (posts, classifications, topics, topic_stats_15m, effective_classifications), getLatestConfig, listTopicDefs, upsertSeedTopics, logEvent, prepareTestDb/truncateAll, AppConfig.retention_days and active_min_items_24h" }
  - { phase: 02-ingestion, provides: "index.ts boot with pg-boss and the '// Phase 03' hook, ensureQueues, createLogger" }
  - { phase: 03-classification, provides: "triagePosts, HashingEmbedder/createEmbedder, cosine/centroid/toPgVector (03-01); createClassifier, classifyInBatches, ClassificationCache, FewShotExample, wrapUntrusted (03-02)" }
provides:
  - "rollup/index.ts: bucketStart(d), recomputeRange(h, {from, to}), runRollup(h, now, {mode?: 'recent'|'full7d'}) -> {mode, buckets, rows, status}, bucketRanges, resolveRollupMode"
  - "rollup/active.ts: refreshTopicStatus(h, now, minItems24h) and ACTIVE_MIN_ITEMS_24H = 10"
  - "pipeline/deps.ts: PipelineDeps {classifier, embedder, summarizer, log, usage?}, async createPipelineDeps(h, env, {log?, terms?}), UsageMeter"
  - "pipeline/db.ts: loadFewShot, dbClassificationCache, pendingPosts, loadClassifierTopics, topicIdsBySlug"
  - "pipeline/classify-step.ts: runClassifyBatch(h, deps, {now, triageLimit, limit}) -> {triage, pending, classified, cacheHits, failed, usage?}"
  - "pipeline/summarizer.ts: Summarizer, StubSummarizer, AnthropicSummarizer, createSummarizer; pipeline/summaries.ts: runSummaries(h, deps, now)"
  - "pipeline/emerging.ts: clusterUnclassified, isCandidate, emergingSlug, topTokens, runEmerging(h, deps, now)"
  - "retention.ts: retentionWindows(config), runRetention(h, now, windows)"
  - "jobs.ts: PIPELINE_QUEUES, PIPELINE_SCHEDULES, registerPipelineJobs(boss, h, deps, fns?), wired into worker boot"
affects: [04-dashboard, 05-operator-pages, 06-trust-layer, 07-hardening]
key_files:
  - apps/worker/src/rollup/index.ts
  - apps/worker/src/rollup/active.ts
  - apps/worker/src/pipeline/deps.ts
  - apps/worker/src/pipeline/db.ts
  - apps/worker/src/pipeline/classify-step.ts
  - apps/worker/src/pipeline/summarizer.ts
  - apps/worker/src/pipeline/summaries.ts
  - apps/worker/src/pipeline/emerging.ts
  - apps/worker/src/retention.ts
  - apps/worker/src/jobs.ts
  - apps/worker/src/index.ts
key_decisions:
  - "index.ts hook (Rule 3): the '// Phase 03' placeholder is replaced by one import and one registerPipelineJobs call; createPipelineDeps is re-exported from jobs.ts so one import suffices"
  - "Queues that ensureQueues already created get the stately options through updateQueue; otherwise the options would never apply"
  - "createPipelineDeps is async: the stub classifier reads config terms at boot"
  - "Emerging clustering only moves posts whose effective label is a model row; analyst corrections and gold labels are never moved"
  - "The retention job writes one 'retention' event_log row with the counts; runRetention itself never touches event_log"
issues_created: []
completed: 2026-10-16
---

# 03-03: Classification pipeline jobs, rollups, summaries, Emerging and retention

**Five pg-boss jobs now run in the worker. Every minute, classify-batch triages new posts and labels pending ones (content-hash cache first, then the classifier, with analyst corrections as few-shot examples). Every minute, rollup recomputes sparse topic_stats_15m rows for each topic x entity x lane, with a 7-day repair run at boot and at minute 7 of every hour, and sets seed topics active or dormant at 10 items in 24h. Every 30 minutes, summaries writes two-line topic summaries and emerging turns clusters of unclassified posts into Emerging topics. At 03:00 IST, retention clears raw_json after 30 days and deletes posts and orphaned authors after 90 days.**

## Accomplishments

- `recomputeRange` is one statement inside a transaction. It reads posts joined to `effective_classifications`, buckets them with `date_bin('15 minutes', ...)`, and fans each post out to entity ('all' plus each entity) and lane ('all' plus the post's lane). It upserts with `ON CONFLICT (bucket_start, topic_id, entity, lane) DO UPDATE` and then deletes rows in the range that the recompute no longer produces. The upsert writes only the count columns and `reach_pos`, `reach_neu` and `reach_neg`. The reach columns hold a placeholder: the sum of `coalesce(reach_score, 0)`. `suspected_coordinated`, `burst_flag` and `top5_author_share` keep their stored values.
- In 'recent' mode, `runRollup` recomputes the current and previous buckets plus every bucket holding a post whose classification row was created in the last 3 minutes, limited to the last 7 days. In 'full7d' mode it recomputes [bucket - 7d, bucket + 15m), which is 673 buckets. When no mode is given, it runs 'full7d' at UTC minute 7 and 'recent' otherwise.
- `runClassifyBatch` gives each labelled post one `origin='model'` row. Model or cache entities are merged with the entity keys whose aliases appear in the post's `matched_terms`. An unknown slug, or the generic 'emerging' slug, maps to the unclassified topic with confidence 'low'. A cache hit copies the source row's model and prompt_version. Posts from a failed batch stay pending.
- Summaries: the stub builds its lines from the counts. The Anthropic version uses `output_config: {effort: 'low', format: json_schema {line1, line2}}`, sends no sampling or thinking parameters, wraps posts with `wrapUntrusted`, and has a describe-only instruction (no advice, no reply wording). Each line is collapsed to a single line of at most 140 characters.
- Emerging: leader clustering at cosine 0.80 over model-labelled unclassified posts from the last 72h that have an embedding. A candidate needs at least 5 posts and at least 3 distinct authors; each null author counts as a distinct author. A candidate attaches to an existing live emerging topic at member-centroid cosine 0.85 or more. Otherwise it creates `emerging-<yyyymmdd IST>-<6 hex>`, named `Emerging: <top two tokens>`. The topic and its member rows are written in one transaction. A second run on the same data changes nothing.

## Task commits

1. Task 1: 15-minute rollup recompute and active-topic status - `ce6a02f` (feat)
2. Task 2: classify-batch pipeline step with cache and few-shot from corrections - `6e7f92d` (feat)
3. Task 3: Two-line topic summaries and Emerging candidates - `95989a4` (feat)
4. Task 4: Retention purge and pg-boss job registration - `0ae9d61` (feat)

## Decisions

- Queues that `ensureQueues` (index.ts) already created are switched to `{policy: 'stately', retryLimit: 1, expireInSeconds: 900}` with `updateQueue`. Missing queues are created with those options.
- `createPipelineDeps(h, env, {log?, terms?})` is async because the stub classifier's terms come from the latest config at boot. `PipelineDeps.usage` (a `UsageMeter`) collects classifier token usage, which `runClassifyBatch` logs.
- Timestamps go to postgres-js as ISO strings with `::timestamptz` casts. The drizzle postgres-js driver turns off Date and JSON serialization on the shared client.
- `runRollup` also returns `status` (active, dormant and changed counts).
- `runSummaries` computes 24h stats live from posts and `effective_classifications`. Active seed topics need at least 1 item in 24h and emerging topics at least 3. `AnthropicSummarizer` throws on a refusal, on `max_tokens` or on a malformed reply, and the caller logs that topic and skips it.
- Emerging slugs use the IST calendar day. Stopwords include jio, ipo, reliance and shares, so names describe the topic.
- The retention job writes a `retention` event with the counts. `runRetention` deletes classifications explicitly before posts, although the delete cascades anyway.
- No ledger file was written under docs/plans because it is outside the owned paths. The harness had no code-reviewer subagent, so the final review was a self-review.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] Worker boot never registered the pipeline jobs.** index.ts had only a `// Phase 03: registerJobs(boss, db)` comment. The fix replaces it with one import (`createPipelineDeps, registerPipelineJobs` from './jobs') and one `await registerPipelineJobs(boss, {db, sql}, await createPipelineDeps({db, sql}, env, {log: logger}))` statement, which Prettier wraps over 5 lines. Verified by the boot smoke check. Commit `0ae9d61`.

### Deferred (for ISSUES.md)
- The stub classifier's terms are fixed at worker boot. Config edits reach `entitiesFromMatchedTerms` on the next tick but reach the stub only after a restart. (Task 2)
- Summarizer token usage and cost are not metered or logged; only classifier usage is. (Task 3)
- The rollup, the cache and the summaries all join the `effective_classifications` view, which runs DISTINCT ON over every classification. This is fine at v0.1 volume; at scale it may need a LATERAL latest-row form. (Task 1)
- A 'recent' rollup misses a label created more than 3 minutes before it runs, for example when classify-batch runs longer than 3 minutes. The hourly full7d run at :07 repairs it. (Task 1)
- `loadFewShot` uses corrections only, as the plan says, not gold rows. (Task 2)
- Emerging topics never decay: there is no automatic dormancy or dismissal, and the attach centroid uses all members regardless of age. (Task 3)

## Verification

- Tests: `corepack pnpm --filter @jio/worker test` -> 40 files, 531 passed, 0 failed. New: rollup 12, pipeline 23, retention 3, jobs 3.
- TDD: Tasks 1, 2 and 4 showed RED before implementation: "Failed to load url ./index | ./active | ./classify-step | ./jobs | ./retention". Task 3's RED step (missing modules) was not run separately before implementing.
- `corepack pnpm --filter @jio/worker typecheck` -> clean. `eslint apps/worker` -> clean. `prettier --check` on owned paths -> clean.
- Boot smoke check against the docker DB with every API key empty and SOURCES_MODE=fixture: "worker ready", then "rollup job done" (full7d, 673 buckets) within seconds, then "classify-batch job done" (120 triaged, 109 classified, 0 failed) at the next minute. No warn or error lines. On the next boot, the full7d rollup wrote 428 topic_stats_15m rows (`select count(*)` > 0).

## Next-phase readiness

- 04-01: read sparse `topic_stats_15m` rows (items > 0). They hold raw counts only, so apply the 30-item rule at read time. `topics.summary_2line` is two lines separated by '\n'. Emerging topics have kind 'emerging' and slugs starting `emerging-`; exclude the generic slug 'emerging'.
- 06-01/06-02: the rollup upsert preserves the coordination columns but deletes a row whose slice empties. Fill the reach columns properly by replacing the placeholder sum of `reach_score`.
- 07-01: call `runRollup(h, now, {mode})`, `runClassifyBatch(h, deps, {now})`, `runSummaries` and `runEmerging(h, deps, now)`, and `runRetention(h, now, retentionWindows(config))`. Build deps with `createPipelineDeps(h, {ANTHROPIC_API_KEY: '', VOYAGE_API_KEY: ''}, {log})`.
