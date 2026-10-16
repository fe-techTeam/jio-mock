---
phase: 03-classification
plan: 02
requires:
  - { phase: 01-data-and-login, provides: "TopicDef, SEED_TOPICS, TermsConfig/DEFAULT_CONFIG, SENTIMENTS/ENTITY_KEYS/CONFIDENCES, normalizeForMatch" }
  - { phase: 02-ingestion, provides: "worker layout, vitest conventions, pino logger" }
provides:
  - "Classifier interface (readonly model, promptVersion, classify(items, topics)) and ClassifyResult, ClassifierInput, FewShotExample, UNCLASSIFIED_SLUG, EMERGING_SLUG, classifiableTopics, normalizeResult, lowResult (classify/classifier.ts)"
  - "PROMPT_VERSION 'cls-v1-2026-10-16', MAX_POST_CHARS 6000, wrapUntrusted, buildSystemPrompt, buildUserMessage, buildOutputSchema (classify/prompt.ts)"
  - "StubClassifier (model/promptVersion 'stub-v1'), STUB_HINTS, POSITIVE_TERMS, NEGATIVE_TERMS (classify/stub.ts)"
  - "AnthropicClassifier, createClassifier, usageCost, ClassifierUsage, Haiku 5.5 price constants (classify/anthropic.ts)"
  - "classifyInBatches, planBatches, ClassifyItem, ClassificationCache, CachedLabel (classify/batch.ts)"
  - "@anthropic-ai/sdk ^0.135.0 in @jio/worker"
affects: [03-03, 05-operator-pages, 06-trust-layer, 07-hardening]
key_files:
  - apps/worker/src/classify/classifier.ts
  - apps/worker/src/classify/prompt.ts
  - apps/worker/src/classify/stub.ts
  - apps/worker/src/classify/anthropic.ts
  - apps/worker/src/classify/batch.ts
key_decisions:
  - "createClassifier lives in anthropic.ts, not classifier.ts: a re-export from classifier.ts would create a classifier -> anthropic -> classifier import cycle"
  - "The classifier never assigns the 'emerging' or 'unclassified' buckets: classifiableTopics drops slug emerging/unclassified and kind unclassified from the prompt, the schema enum and validSlugs"
  - "Raw label shape is the model's schema item {topic, sentiment, entities, confidence, gloss_en}; the stub emits the same shape so both go through normalizeResult"
  - "'<' inside wrapped JSON is escaped as \\u003c (JSON.parse still decodes it), so post text cannot close <untrusted_posts>"
  - "onUsage inputTokens = uncached + cache-write + cache-read tokens; cost prices cache writes at 1.25x and reads at 0.1x of $0.10/MTok, output at $0.50/MTok"
  - "CLASSIFIER_MODEL empty string is treated as unset (falls back to claude-haiku-5-5)"
issues_created: []
completed: 2026-10-16
---

# 03-02: LLM classifier, stub and batching

**A `Classifier` contract with zod-validated normalization (unsure, unknown or malformed labels become `unclassified`/low), an injection-safe prompt builder, a deterministic multilingual keyword stub, a Claude Haiku 5.5 classifier using structured JSON output and a cached system prompt, and a content-hash-aware batcher (20-50 per call, concurrency 2, failures isolated per batch).**

## Accomplishments

- `normalizeResult(raw, postId, validSlugs)`: a zod failure gives `{unclassified, neutral, [], low, null}`. An unknown slug, the slug 'unclassified' or confidence 'low' gives `unclassified`/low and keeps sentiment and entities. Entities are deduped and filtered to EntityKey. The gloss is trimmed and cut to 200 chars, and '' becomes null.
- `wrapUntrusted` writes one JSON object per line inside `<untrusted_posts>`. Text is cut to 6000 UTF-16 units without splitting a surrogate pair, and every '<' is escaped. The system prompt is deterministic: static instructions, then topics (with up to 5 example phrases each), then up to 20 few-shot examples rendered through `wrapUntrusted` (refs e0..) with their gold labels. User messages use refs p0..pN, never database ids. `buildOutputSchema` requires every property and sets `additionalProperties: false` at every level.
- `StubClassifier`: per-topic score = distinct matched terms from example phrases, name words longer than 3 chars, and `STUB_HINTS` (regex over the topic name, word-bounded so 'ai' does not match 'retail' or 'complaints'). Matching uses Unicode letter/mark/number boundaries on `normalizeForMatch` text. Ties go to topic order, and a score of 0 gives unclassified/low. Sentiment comes from the lexicon balance. Entities come from `terms.entities` aliases, plus 'jio' for 'jio ipo', 'जियो आईपीओ' or 'જિયો આઈપીઓ' (never for a bare 'jio'). Non-en posts get the gloss `'[stub] ' + first 100 code points`.
- `AnthropicClassifier` sends one `messages.create` per batch with: model; `max_tokens` 8000; a single system text block with `cache_control: ephemeral`; one user message; and `output_config {effort:'low', format:{type:'json_schema', schema}}`. It sends no sampling, thinking, prefill or tool_choice fields. It checks `stop_reason` first: 'refusal' or 'max_tokens' labels every item low. It reads the first text block (skipping thinking blocks), then JSON.parse and zod. Missing refs get low labels, duplicate refs keep the first, and unknown refs are ignored. RateLimitError, APIConnectionError, 5xx and other API errors are rethrown. BadRequestError labels every item low and is logged through `log.warn`. A client built without injection uses `maxRetries: 3`.
- `classifyInBatches` runs in four steps: a cache lookup on the unique hashes (hits fan out to every post with that hash), one representative per remaining hash, near-equal `planBatches` chunks through a promise pool (default concurrency 2), and finally labels copied to duplicates. A batch that throws, or a post the classifier left out, puts those posts and their duplicates in `failedPostIds`. Results come back in input order, and every input postId appears exactly once in `results` or `failedPostIds`.

## Task commits

1. Task 1: Classifier contract, result normalization and prompt builder - `5fbd3ee` (feat)
2. Task 2: Deterministic stub classifier - `548ee71` (feat)
3. Task 3: Anthropic classifier with structured JSON output - `2b5fd0c` (feat)
4. Task 4: Batching, dedupe and content-hash cache - `d2a1d4d` (feat)
5. Metadata - the harness refused the SUMMARY write; the orchestrator commits it

## Decisions

- createClassifier is exported from `anthropic.ts` to avoid an import cycle. Import it from `./classify/anthropic`.
- The prompt, schema enum and validSlugs exclude the emerging/unclassified buckets, so the model can only pick a real topic or `unclassified`.
- `AnthropicClassifier` takes an extra optional `log?: Pick<Logger,'warn'>`, and `createClassifier` passes it through. `classifyInBatches` also accepts `log`.
- `AnthropicClassifier.client` is public and readonly so tests can assert the SDK client config.
- `buildUserMessage` is generic over `{text, lang}` items, so callers can pass full ClassifierInput objects.
- Price constants are named in anthropic.ts: `HAIKU_INPUT_USD_PER_MTOK` 0.10, `HAIKU_OUTPUT_USD_PER_MTOK` 0.50, `CACHE_WRITE_MULTIPLIER` 1.25 and `CACHE_READ_MULTIPLIER` 0.1.

## Deviations from plan

- The plan text says '<' is replaced with "`<`", which is an HTML-mangled `<`. The code uses the JSON escape `<`.
- The plan's verification grep (`temperature|budget_tokens|tool_choice` in anthropic.ts) originally matched an explanatory comment. The comment was reworded so the grep finds nothing.
- The STATE.md update and the ledger (`docs/plans/*.progress.md`) were skipped because the orchestrator forbids edits outside files_modified. In inline mode no subagent tool was available for the end-of-plan code-reviewer pass, so the implementer reviewed its own diff.

### Auto-fixed
- **[Rule 3 - blocker] Adding @anthropic-ai/sdk pulled in @opentelemetry/api**, which changed the peer-resolved drizzle-orm variant in the lockfile. After the filtered `pnpm add`, packages/db still linked the old drizzle copy, so worker typecheck failed with drizzle type mismatches. Fix: ran a workspace `pnpm install` to relink. Verified by: root `pnpm typecheck` clean in all 4 packages. Commit `2b5fd0c` (lockfile).

### Deferred (for the orchestrator to log in ISSUES.md)
- Haiku 5.5 may have a minimum cacheable prefix above the current system prompt size (no few-shot), in which case `cache_control` silently does nothing. Check `cache_read_input_tokens` once a key is live. (Task 3)
- Refusal, max_tokens and BadRequest batches come back as normal low/unclassified results. If 03-03 caches every result by content_hash, those posts will never be retried. Consider skipping the cache write for those, or retrying them once. (Task 3/4)
- The stub's entity matching for 'jio' ignores `terms.ipo_terms` and hashtags such as #JioIPO. The keyword matcher in @jio/core already tags these, so 03-03 could merge the triage entities. (Task 2)
- Prices assume prompts up to 100K tokens. A 50-post batch of 6000-char posts could pass 100K, where Haiku 5.5 charges $0.50/$2.50. (Task 3)

## Verification

- Tests: `corepack pnpm --filter @jio/worker test` (ANTHROPIC_API_KEY unset; anthropic tests stub `fetch` to throw) -> 32 files, 490 passed, 0 failed. Classify tests: classifier 14, prompt 14, stub 14, anthropic 22, batch 17.
- Types: `corepack pnpm typecheck` -> core, db, web and worker all Done.
- Lint: `corepack pnpm lint` (eslint --max-warnings=0) -> clean. Prettier check on all owned files -> clean.
- `grep -rn "temperature\|budget_tokens\|tool_choice" apps/worker/src/classify/anthropic.ts` -> no matches.

## Next-phase readiness

- 03-03 wiring: `createClassifier({ apiKey: env.ANTHROPIC_API_KEY, model: env.CLASSIFIER_MODEL, terms: config.terms, getFewShot, onUsage, log })` from `./classify/anthropic`. Then `classifyInBatches(items, topics, { classifier, cache, log })`, where `cache.get(hashes)` returns `Map<hash, CachedLabel>`. Store `classifier.model` and `classifier.promptVersion` on each classification row so the cache can be keyed or invalidated by prompt version.
- `failedPostIds` stay pending for the next tick, and `results` is ready to insert as `origin: 'model'`.
