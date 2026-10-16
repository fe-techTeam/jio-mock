---
phase: 05-operator-pages
plan: 03
requires:
  - { phase: 01-data-and-login, provides: "classifications (origin, actor), effective_classifications view, posts.is_fixture, event_log 'relabel' kind, test-db harness" }
  - { phase: 03-classification, provides: "model rows with prompt_version; few-shot cap of 20 corrections" }
  - { phase: 04-dashboard, provides: "withApi/ParamError helpers, EvidenceItem, EvidenceCard + RelabelControls stub, queryKeys, fetchJson, shell format helpers, Providers" }
provides:
  - "POST /api/labels (correction | gold) -> {ok, classificationId}; DELETE /api/labels/[id] (10-minute undo); GET /api/labels/queue (blind, stratified gold queue)"
  - "GET /api/accuracy?promptVersion=latest|{v}: overall, per-language, 3x3 confusion, sarcasm subset, unscored, corrections; all null below 200 gold posts"
  - "computeAccuracy pure function (app/api/accuracy/_lib/compute.ts)"
  - "RelabelControls: optimistic sentiment, topic and entity relabel with 10s Undo and revert on error"
  - "/accuracy page: header, language table, confusion matrix, sarcasm line, corrections card, gold labelling queue with keyboard 1/2/3, skip and Re-score"
affects: [06-trust-layer, 07-hardening]
key_files:
  - apps/web/src/app/api/labels/_lib/contract.ts
  - apps/web/src/app/api/labels/_lib/labels.ts
  - apps/web/src/app/api/labels/route.ts
  - apps/web/src/app/api/labels/[id]/route.ts
  - apps/web/src/app/api/labels/queue/route.ts
  - apps/web/src/app/api/accuracy/route.ts
  - apps/web/src/app/api/accuracy/_lib/compute.ts
  - apps/web/src/components/evidence/relabel.tsx
  - apps/web/src/components/accuracy/accuracy-view.tsx
  - apps/web/src/components/accuracy/gold-queue.tsx
  - apps/web/src/app/(app)/accuracy/page.tsx
key_decisions:
  - "Gold queue excludes fixture posts: the gold set measures real data only"
  - "Label write plus relabel event in one transaction; advisory lock on gold writes keeps the 200 cap exact"
  - "Sarcasm kept in the gold relabel event detail (no column on classifications)"
  - "RelabelControls keeps the 04-02 props ({item}) plus optional topics; native select and inline Undo bar"
  - "QueueResponse gains additive topics list for the gold form"
issues_created: []
completed: 2026-10-16
---

# 05-03: Relabel and accuracy

**Operators can correct any post's sentiment, topic and entities from the evidence drawer (applied at once, undoable for 10 seconds, reverted on failure) and label a stratified 200-post gold set on /accuracy, with accuracy computed from gold vs model rows only and withheld until 200 are labelled.**

## Accomplishments

- Labels API: corrections and gold rows become the effective label, gold wins over corrections, the 201st distinct gold post is rejected with 409, undo is limited to human rows under 10 minutes old, and each write or undo logs exactly one 'relabel' event.
- Gold queue is blind (no model sentiment or topic), excludes fixtures and skip-listed ids, picks the language with the fewest gold labels (en, hinglish, hi, gu), and returns no author fields.
- Accuracy: overall sentiment, topic and exact-entity rates, per language, a 3x3 confusion matrix (gold rows, model columns), a sarcasm subset, an unscored count and a prompt-version filter. Below 200 every figure is null.
- UI: RelabelControls inside every EvidenceCard; /accuracy shows "Not measured yet: n of 200 labelled" with no percentage until measured.

## Task commits

1. Task 1: Labels API with gold queue and undo - `7dd346a` (feat)
2. Task 2: Accuracy computation and GET /api/accuracy - (feat, see git log)
3. Task 3: Relabel controls in the evidence drawer - `3b8a66e` (feat)
4. Task 4: Accuracy page with gold labelling queue - `cc5f5b3` (feat)

## Decisions

- Fixture posts are excluded from the gold queue (record in DECISIONS.md).
- Relabel write and its event share one SQL transaction; gold writes take an advisory lock.
- Sarcasm lives only in the gold relabel event detail; the accuracy route reads the latest gold event per post.
- RelabelControls kept the stub's `{item}` props (plus optional `topics`) instead of the plan's `{postId, current, topics}`; topic names load lazily from the brief query when the select is first used.
- Native select and an inline Undo bar replace Radix Select and a toast, for jsdom testability.
- QueueResponse gained an additive `topics` list; LabelResponse gained `classificationId`.

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] 04-02 evidence.test.tsx rendered EvidenceCard without a QueryClient** - found in Task 3; fix: switched three `render` calls to `renderWithClient` (file not in files_modified); verified by: evidence suite 13/13 passing.
- **[Rule 3] RelabelControls props** - the existing stub took `{item}`, so the plan's props were adapted as above. No change to evidence-card.tsx was needed (it already renders the controls).

### Deferred to ISSUES.md
- Sarcasm has no column on classifications (contract gap); consider adding one.
- Relabel topic options come from active ranked brief topics only; Emerging and Unclassified are not offered.
- labels.test.ts failed two tests once on its first run and passed on three reruns; likely shared-Postgres contention with parallel agents.

## Verification

- Tests: `corepack pnpm --filter @jio/web test` -> 36 files, 381 tests passed (includes the other wave-1 plans' tests present in the tree)
- Types: `tsc --noEmit` clean; lint clean on owned paths; prettier check clean on owned paths
- Build: `corepack pnpm --filter @jio/web build` passed; /accuracy and /api/labels, /api/accuracy routes listed

## Next-phase readiness

- 07-hardening e2e can drive relabel from the drawer and the gold flow on /accuracy.
- 06-trust-layer can reuse the labels API for anything that needs human overrides.
- The orchestrator should update STATE, DECISIONS and ISSUES from this summary; this agent did not touch them.
