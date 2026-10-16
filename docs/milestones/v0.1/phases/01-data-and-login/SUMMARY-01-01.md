---
phase: 01-data-and-login
plan: 01
requires:
  - { phase: 00-foundation, provides: "@jio/core skeleton and time helpers" }
provides:
  - "@jio/core domain constants (SOURCE_KEYS, ENTITY_KEYS, EVENT_KINDS incl. login_locked/logout/retention, SOURCE_PLATFORM, SOURCE_DEFAULT_LANE)"
  - "adapter interfaces (NormalizedPost with optional lane, NormalizedMarketPoint, FetchContext, FetchResult, SourceAdapter) and api-types skeleton"
  - "zod TermsConfig / SourceConfig / AppConfig, AppConfigInput, DEFAULT_CONFIG (4-language seed lists, resolved cadence)"
  - "SEED_TOPICS (10 seeded + emerging + unclassified) and TopicDef"
  - "keyword matcher: matchTerms(text, terms) / compileMatcher(terms), normalizeForMatch"
  - "startOfIstDay in @jio/core/time"
affects: [01-02, 02-ingestion, 03-classification, 04-dashboard, 05-operator-pages]
key_files: [packages/core/src/types.ts, packages/core/src/adapter.ts, packages/core/src/api-types.ts, packages/core/src/config-schema.ts, packages/core/src/seed-topics.ts, packages/core/src/matcher.ts, packages/core/src/time.ts]
key_decisions:
  - "TermsConfig adds anchor_groups [{name, terms}] and generic_hashtags, so the bare-'jio' rule is data: strong terms match alone; anchors (jio/reliance/ambani groups) need a co-occurrence term or a second group"
  - "SourceConfig.creds_ref is Record<string,string>|null (env-style name -> 'enc:v1:' blob), not a string"
  - "Config keys are snake_case; rate_limits default to {}"
  - "Negative terms are masked before matching ('Jio Financial Services' cannot anchor)"
issues_created: [anchor_pair accepts Reliance+Ambani without Jio, matcher does not strip URLs/@handles, DEFAULT_CONFIG is mutable and matcher caches by identity]
completed: 2026-10-16
---

# 01-01: Core domain types, config and keyword matcher

**@jio/core domain constants, adapter and API types, zod AppConfig + DEFAULT_CONFIG (4-language seed lists split into strong terms and anchors, resolved cadence), 12 seed topics, and a Unicode-boundary keyword matcher in which a bare 'jio' or 'जियो' never matches alone.**

Written by the orchestrator from the implementer's returned result; the subagent harness blocked its SUMMARY write.

## Accomplishments

- Imports: `@jio/core` or `@jio/core/<module>` (types, adapter, api-types, config-schema, seed-topics, matcher, time). zod ^3.23 is the only runtime dependency, with no `node:` imports.
- Matcher returns `{relevant, reason: 'strong'|'anchor_cooccurrence'|'anchor_pair'|'negative'|'none', matchedTerms, entities, negativeHits}`. Input is truncated to 20,000 chars. `matchedTerms` holds only the hits behind the deciding reason, in config spelling and text order.
- Entity 'jio' is added for an ipo_terms or hashtag hit, unless that hit overlaps a person alias (#MukeshAmbani gives ['mukesh'] only).
- AppConfig: `{terms, sources (all 11 required), retention_days {raw_json, post_text, authors}, min_items_for_split, active_min_items_24h, backfill_days, person_level_views: false}`. SourceConfig: `{enabled, lane, interval_min, market_hours_interval_min, coverage_label, x_tier, rate_limits, creds_ref, params}`.
- Tests: core 117 passing (types 13, time 15, config-schema 22, seed-topics 7, matcher 60). Root lint, typecheck and format:check are green.

## Task commits

- 0d9e60f feat(01-01): Domain constants, adapter interfaces and api-types skeleton
- 97f1a15 feat(01-01): Config schema, DEFAULT_CONFIG and seed topics
- 2de6b9e feat(01-01): Keyword matcher with co-occurrence and negative terms

## Deviations

- The zod schemas landed in the Task 1 commit because adapter.ts imports their types.
- Topic names use the head of each design-resolution name, with the detail in the description.

## Notes for later plans

- 03-01: strip URLs and @handles before matching. `https://x.com/jio_ipo` matches 'Jio IPO' because '_' normalizes to a space. Map reason 'negative' to the triage negative_term.
- Callers must `structuredClone(DEFAULT_CONFIG)` before editing it.
- `anchor_pair` treats Reliance plus Ambani as relevant with no Jio term; rely on the LLM stage to drop off-topic items.
