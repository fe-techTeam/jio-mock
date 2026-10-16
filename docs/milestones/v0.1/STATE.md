# v0.1 State

**Goal:** Locally running always-on Jio IPO sentiment board: every source ingested (fixtures until keys), classified, rolled up, served behind one login.
**Current focus:** Milestone build complete; verification and review

## Position

Phase: Milestone build complete; verification and review
Plan: 0 of 3 in this phase
Status: Ready to execute
Last activity: 2026-10-16 - 07-hardening closed green
Progress: 23 / 23

## Recent decisions

- 02: fetch_run status ok|error|rate_limited; only error opens the breaker
- 02: creds enc:v1 AES-256-GCM, creds_ref wins over env
- 02: since/cursor from latest ok run in the same mode
- 02: post lane resolved before upsert; fixture market points suffixed #fixture
- 02: portal observedAt is page time, so repeat fixture runs add 0 points

## Open blockers

None.

## Deferred issues

101 open - see ISSUES.md.

## Session continuity

Last session: 2026-10-16
Stopped at: 07-hardening closed
Next: full verification gate, then code/security/silent-failure review
