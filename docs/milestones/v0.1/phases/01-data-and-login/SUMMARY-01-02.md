---
phase: 01-data-and-login
plan: 02
requires:
  - { phase: 00-foundation, provides: "createDb, pingDb, Db, ensureTestDatabase, drizzle.config, db:generate/db:migrate" }
  - { phase: 01-data-and-login, provides: "AppConfig, AppConfigInput, DEFAULT_CONFIG, SEED_TOPICS, SOURCE_KEYS, SOURCE_DEFAULT_LANE, NormalizedPost, NormalizedMarketPoint, startOfIstDay (01-01)" }
provides:
  - "tables authors, posts, topics, classifications, topic_stats_15m, market_points, config_versions, event_log, Better Auth user/session/account/verification"
  - "view effective_classifications (SELECT c.* ; same columns as classifications)"
  - "runMigrations(url) with an advisory lock"
  - "config helpers getLatestConfig, saveConfigVersion(db, cfg, actor, {expectedVersion?}), ConfigConflictError, ConfigParseError"
  - "event helpers logEvent, sourceHealth(db, now?), recentFetchRuns(db, sourceKey, limit=10), loginFailuresSince(db, email, since)"
  - "topic helpers upsertSeedTopics(db, defs?), listTopicDefs(db, {kinds?})"
  - "upsertPosts(db, posts, {isFixture, lane?, authorRetentionDays?, now?}) -> {inserted, duplicates, rejected, insertedIds}; insertMarketPoints(db, points)"
  - "seedBase(db) and the db:seed script (config v1 + 12 topics, then web seed:user)"
  - "@jio/db/testing: testDatabaseUrl(name), prepareTestDb(name), connectTestDb(url), truncateAll(sql), ensureTestDatabase, TEST_DATABASE_URL"
affects: [01-03, 02-ingestion, 03-classification, 04-dashboard, 05-operator-pages]
key_files: [packages/db/src/schema.ts, packages/db/src/auth-schema.ts, packages/db/migrations, packages/db/src/queries/config.ts, packages/db/src/queries/events.ts, packages/db/src/queries/topics.ts, packages/db/src/queries/posts.ts, packages/db/src/queries/market.ts, packages/db/src/seed.ts, packages/db/src/testing.ts]
key_decisions:
  - "Per-package test DBs: @jio/db owns jio_ipo_test; other packages call prepareTestDb('jio_ipo_test_<pkg>') in their globalSetup"
  - "Config stored as one jsonb column per config_versions row; new AppConfig keys need no migration"
  - "Added columns posts.lane, classifications.actor, topics.merged_into_id, event_log.actor"
  - "topic_stats_15m.topic_id cascades on topic delete; classifications.topic_id is restrict"
  - "Authors upserted in sorted key order to avoid deadlocks"
issues_created: [worker globalSetup still uses jio_ipo_test, effective_classifications view must be recreated when classifications gains a column]
completed: 2026-10-16
---

# 01-02: Full schema, migrations, query helpers and seed

**The full Drizzle schema (8 domain tables, the Better Auth tables, and the effective_classifications view with a pgvector HNSW index on posts.embedding) is migrated. It comes with typed query helpers for config versions, events, topics, posts and market points, an idempotent seed, and a per-package test database harness.**

Written by the orchestrator from the implementer's returned result; the subagent harness blocked its SUMMARY write.

## Schema

- authors(id, platform, platform_user_id [unique pair], handle, display_name, followers, kind, first_seen_at, last_seen_at, delete_after)
- posts(id, source_key, external_id [unique pair], url, author_id -> authors set null, lane, text, lang, published_at, fetched_at, reach_raw, reach_score, content_hash, embedding vector(1024) HNSW cosine, near_dup_cluster_id, matched_terms, raw_json (nullable), is_fixture)
- topics(id, slug unique, name, kind, description, example_phrases, summary_2line, summary_at, status, promoted_at, merged_into_id, created_at)
- classifications(id, post_id -> posts cascade, origin, topic_id -> topics restrict, sentiment, entities, confidence, gloss_en, model, prompt_version, actor, created_at)
- topic_stats_15m(bucket_start, topic_id, entity, lane [PK], items, pos, neu, neg, low_conf, reach_pos, reach_neu, reach_neg, suspected_coordinated, burst_flag, top5_author_share, updated_at)
- market_points(id, series, value, observed_at, source_key, source_url, fetched_at; unique series + source_key + observed_at)
- config_versions(version pk, saved_at, actor, config jsonb)
- event_log(id identity, at, kind, source_key, status, items_new, cost_usd, duration_ms, error, ip, actor, detail)

## Notes for later plans

- 01-03: pass Better Auth's drizzle adapter `{user, session, account, verification}` from `schema` (provider 'pg'). `db:seed` runs `pnpm --filter @jio/web run --if-present seed:user`.
- 02-01: call `upsertPosts`, then `logEvent({kind:'fetch_run', sourceKey, status, itemsNew, costUsd, durationMs})`. `sourceHealth(db, now)` returns 11 rows. Switch the worker globalSetup to `prepareTestDb('jio_ipo_test_worker')`.
- 03-01: untriaged posts have `posts.lang IS NULL` (there is a partial index). `upsertPosts` leaves lang, content_hash, matched_terms and embedding empty.
- 03-03: deleting a post cascades its classifications.
- 05-02: `saveConfigVersion` is safe inside a transaction that holds `pg_advisory_xact_lock(hashtext('config_versions'))`. It throws ConfigConflictError or ZodError.
- `config_change` event detail is `{version, previousVersion}`.

## Verification

@jio/db: 8 test files, 51 tests passing. Root test: web 10, core 117, db 51, worker 8 and node:test 14, all passing. drizzle-kit check is clean, and running generate a second time makes no new migration. On the dev DB, migrating and then seeding twice leaves 12 topics and 1 config version.

## Task commits

34a93b6, 04ccb83, c56ad23, 36d8039, 9d4811b (fix: stable author upsert order and cloned default config).

## Deviations

- drizzle 0.45 wraps pg errors, so the test checks `cause.code` 23505.
- runMigrations is advisory-locked because parallel packages migrate the same test DB.
- An extra topics.int.test.ts was added.
