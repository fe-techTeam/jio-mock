---
phase: 03-classification
plan: 01
requires:
  - { phase: 01-data-and-login, provides: "matchTerms/TermsConfig/DEFAULT_CONFIG/LANGS (01-01); posts columns lang, content_hash, matched_terms, embedding vector(1024) HNSW, near_dup_cluster_id, createDb, upsertPosts, prepareTestDb/connectTestDb/truncateAll (01-02)" }
  - { phase: 02-ingestion, provides: "posts landing via upsertPosts with lang NULL; worker test conventions (per-file test DB, fetch stubbed to throw)" }
provides:
  - "triagePosts({db, sql}, {embedder, terms, limit=500, log?}) -> TriageStats {scanned, relevant, dropped, embedded, clustered, embedCostUsd} (apps/worker/src/triage/index.ts)"
  - "detectLang(text): Lang and HINGLISH_MARKERS (triage/lang.ts)"
  - "normalizeForHash / contentHash (sha256 hex, URL, @mention, zero-width and RT-prefix insensitive) (triage/hash.ts)"
  - "assessRelevance(text, terms) -> {relevant, matchedTerms, reason: match|no_match|negative_term}, wrapping @jio/core matchTerms after stripping URLs and @handles (triage/relevance.ts)"
  - "cosine, l2normalize, centroid, isZeroVector, toPgVector (triage/vector.ts)"
  - "assignNearDup, NEAR_DUP_COSINE=0.95, NEIGHBOR_WINDOW_HOURS=48, cluster ids nd_<seed post id> (triage/near-dup.ts)"
  - "selectUntriaged, findNeighbors, writeTriage and the Sql type alias (triage/repo.ts)"
  - "Embedder interface, EMBED_DIMS=1024, createEmbedder({apiKey?, fetchImpl?}) (classify/embedder.ts)"
  - "HashingEmbedder 'hash-stub-v1', hashEmbed, fnv1a (classify/embed-stub.ts)"
  - "VoyageEmbedder 'voyage-multilingual-2' over fetch, EmbedError {status, body} (classify/voyage.ts)"
  - "Markers: lang IS NULL = untriaged; after triage matched_terms '{}' with embedding NULL = dropped; matched_terms non-empty with embedding NULL = relevant but not embedded (embed failure or all-zero vector)"
affects: [03-03, 05-operator-pages, 06-trust-layer, 07-hardening]
key_files:
  - apps/worker/src/triage/index.ts
  - apps/worker/src/triage/repo.ts
  - apps/worker/src/triage/near-dup.ts
  - apps/worker/src/triage/lang.ts
  - apps/worker/src/triage/relevance.ts
  - apps/worker/src/triage/hash.ts
  - apps/worker/src/triage/text.ts
  - apps/worker/src/triage/vector.ts
  - apps/worker/src/classify/embedder.ts
  - apps/worker/src/classify/embed-stub.ts
  - apps/worker/src/classify/voyage.ts
key_decisions:
  - "detectLang counts script shares per word token (each word takes its majority script), not per letter: the plan's own case 'जियो IPO allotment' is only 25% Devanagari by letters but 33% by words"
  - "Embedding stub lives at classify/embed-stub.ts (CONTRACTS names classify/stub.ts, which ROADMAP gives to the classifier stub)"
  - "The worker has no direct 'postgres' dependency, so repo.ts types the client as ReturnType<typeof createDb>['sql'] (exported as Sql) instead of adding one"
  - "Reasons for the seed 'live' phrases ('jio aur jeene do', 'khul ke jio', 'जियो और जीने दो') are negative_term, not no_match: they are seed negative terms in the brew spec; tests assert not-relevant and accept either reason"
  - "writeTriage updates only rows still lang IS NULL, and neighbor cluster updates only fill an empty near_dup_cluster_id, so a concurrent pass cannot overwrite results"
issues_created: []
completed: 2026-10-16
---

# 03-01: Triage stage (language, hash, relevance, embeddings, near-duplicates)

**Every untriaged post now gets a language (en, hinglish, hi, gu, other), a URL- and RT-insensitive sha256 content hash and a keyword relevance verdict from the @jio/core matcher. Relevant posts are embedded with Voyage `voyage-multilingual-2` when VOYAGE_API_KEY is set, or with a deterministic 1024-dim hashing stub when it is not, and assigned near-duplicate clusters at cosine >= 0.95 within +-48h. All of this runs through `triagePosts`, which 03-03 calls.**

## Accomplishments

- `triagePosts` selects up to 500 posts with `lang IS NULL` (ordered by fetched_at, id) and runs `detectLang`, `contentHash` and `assessRelevance` on each. Relevant posts are embedded in one `embedder.embed` call, then neighbors are fetched with pgvector cosine (`1 - (embedding <=> v)`, k=5, +-48h, batch excluded) and clustered. Results are written in transactions of 200 rows. A second pass scans 0.
- Dropped posts get lang, content_hash and `matched_terms '{}'`, with no embedding and no cluster. If the embedder throws, relevant posts are still written (lang, hash, terms) without an embedding and the failure is logged. All-zero vectors are stored as NULL.
- Near-duplicates: items are processed oldest first. Each joins the cluster of its most similar neighbor, in the DB or earlier in the batch. An unclustered neighbor seeds `nd_<neighbor id>` and gets it too. Clusters are never merged. Two copies of a tweet that differ only by URL or `RT @x:` share a cluster.
- Voyage client: POSTs `/v1/embeddings` with `input_type: 'document'`, in chunks of 64 inputs, each truncated to 8,000 chars. It reorders results by `data[].index` and retries 429/5xx up to 3 times (500, 1000, 2000 ms, with injectable sleep). It sets a 30s timeout per request and validates every vector (1024 dims, every index present). Any other 4xx throws `EmbedError` with the status and the first 500 chars of the body, never the key. Cost is total_tokens / 1e6 x $0.12.
- The `createEmbedder` factory never reads env. The caller passes `process.env.VOYAGE_API_KEY`, and a blank or whitespace key means the stub.
- Relevance strips URLs and @handles before matching, so `https://x.com/jio_ipo` and `@jio_ipo` can no longer make a post relevant (the SUMMARY-01-01 note).

## Task commits

1. Task 1: Language detection, content hash and relevance - `07b522b` (feat)
2. Task 2: Embedder interface, hashing stub and Voyage client - `eb6ac07` (feat)
3. Task 3: Near-duplicate clustering and the triagePosts pass - `c4407ee` (feat)
4. Refactor: track relevance explicitly in triagePosts - `b6f1a14` (refactor)
5. Metadata - not committed by the implementer (the harness refused the SUMMARY write); the orchestrator writes it.

## Decisions

- detectLang counts per word rather than per letter (see key_decisions), with 30% shares for gu and hi. Latin text needs at least 50% of words, otherwise the result is `other`. It is Hinglish when it has 2 or more marker hits, or markers make up 15% or more of its Latin words.
- `triage/text.ts` (new, under triage/**) holds the shared URL, @mention, hashtag and zero-width cleanup. An e-mail such as `ipo@jio.com` is not treated as a mention.
- `Sql` is derived from `createDb`, so no new worker dependency was added.
- `writeTriage` is guarded by `lang IS NULL`, and neighbor cluster updates only fill an empty cluster id.
- `TriageStats.clustered` counts batch posts that ended in a cluster. A DB neighbor that seeds a cluster is not counted.

## Deviations from plan

### Auto-fixed
- **[Rule 1 - plan case] Mixed-script Hindi** - found in Task 1. Counting by letters gives 'जियो IPO allotment' 25% Devanagari, so the result was not 'hi' as the plan expects. Fix: count shares per word token. Verified by the lang.test.ts case. Commit `07b522b`.
- **[Rule 1 - plan case] 'jio aur jeene do' reason** - found in Task 1. These phrases are seed negative terms, so the matcher reports `negative`, which maps to `negative_term` rather than the plan's `no_match`. The brew spec supports the matcher ("Seed negative terms, dropped at triage"), so no ISSUES entry and no `it.fails` was needed. The tests assert not-relevant with either reason. Commit `07b522b`.
- **[Rule 3 - blocker] Timestamps from the postgres-js client are strings** - found in Task 3. drizzle's postgres-js driver disables the timestamp parsers, so `published_at` came back as a string. Fix: parse it with `new Date` in `selectUntriaged`, and pass the window bounds as ISO strings cast to `::timestamptz`. Verified by triage.int.test.ts. Commit `c4407ee`.
- **[Rule 3 - blocker] `postgres` is not a worker dependency** - found in Task 3. Fix: `type Sql = ReturnType<typeof createDb>['sql']`. Verified by worker tsc. Commit `c4407ee`.

### Deferred (for the orchestrator to file in ISSUES.md)
- Stub and Voyage vectors share posts.embedding with no model column. After VOYAGE_API_KEY is set, old stub vectors and new Voyage vectors get compared (meaningless cosine). A later plan should add `posts.embedding_model`, or null the stub vectors and re-embed when the model changes. (Task 2/3)
- findNeighbors runs ORDER BY on the HNSW index with a published_at filter. pgvector applies the filter after the index scan (ef_search 40), so neighbors in the +-48h window can be missed when the table is large. Consider `SET hnsw.iterative_scan = relaxed_order` (pgvector >= 0.8) or a time-partitioned exact scan. (Task 3)
- Relevant posts whose embedding failed (embedder down) keep `embedding NULL` and are never re-embedded, so they never join a near-duplicate cluster. A re-embed sweep (matched_terms <> '{}' and embedding IS NULL) is needed. (Task 3)
- Two concurrent triage passes would both select and embed the same posts (double cost). The first write wins because of the `lang IS NULL` guard. 03-03 should run classify-batch as a pg-boss singleton, or selection should move to `FOR UPDATE SKIP LOCKED` with a claim column. (Task 3)
- findNeighbors issues one query per relevant post (up to 500 per pass). This is fine at the current volume; batch it with a LATERAL join if triage gets slow. (Task 3)

## Verification

- Tests: `apps/worker: vitest run` -> 31 files, 473 passed, 0 failed. This includes the 03-02 files present in the tree. The 03-01 files alone account for 73 tests: lang 14, hash 7, relevance 12, embedder 4, embed-stub 7, voyage 9, vector 6, near-dup 8, triage.int 6. The integration test runs against DB `jio_ipo_test_worker_triage`.
- No network: every 03-01 test file stubs global `fetch` to throw, and the Voyage tests use an injected `fetchImpl`.
- Types: `apps/worker tsc --noEmit` is clean. Lint: `eslint --max-warnings=0 apps/worker` is clean. Prettier check is clean on all 03-01 files.
- TDD: each module's test was run RED first (module missing) and then GREEN.
- A separate code-reviewer subagent was not available in this harness, so the review was done inline by the implementer instead.

## Next-phase readiness

- 03-03: call `triagePosts({db, sql}, {embedder: createEmbedder({apiKey: env.VOYAGE_API_KEY}), terms: config.terms, log})` before classifying. Classify only posts with `lang IS NOT NULL AND matched_terms <> '{}'`. Use `content_hash` as the classification cache key. Add `embedCostUsd` to the job's cost event.
- 06-02: `near_dup_cluster_id` (`nd_<seed post id>`) is a raw cosine >= 0.95 cluster. The brew rule (5 or more distinct authors within 60 minutes) still has to be applied at rollup time.
- Emerging clustering can reuse `cosine`, `centroid` and `toPgVector` from `apps/worker/src/triage`.
- Concern: the stub/Voyage vector-mixing risk above has to be handled before live keys go in.
