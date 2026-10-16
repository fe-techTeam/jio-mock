# v0.1 Issues

Deferred enhancements and known gaps, numbered ISS-NNN. Add new ones at the bottom: `ISS-NNN: <one line> (found in NN-MM, Task N)`.

- ISS-001: Spike and negative-shift alerts (email, Slack, WhatsApp) deferred by developer decision (found in design)
- ISS-002: Deploy to Vercel, Fly.io and Supabase Mumbai not run in v0.1; local only (found in design)
- ISS-003: pgboss.queue holds 7 rows (6 contract queues plus internal __pgboss__send-it); plan's 6-row check is inexact (found in 00-03)
- ISS-004: SUMMARY-01-01.md and SUMMARY-01-02.md not written (harness blocked subagent file writes); docs commits missing (found in 01-01, 01-02)
- ISS-005: anchor_pair accepts Reliance + Ambani with no Jio or IPO term; 03-0x should lean on the LLM stage or restrict anchor_pair to pairs including the jio group (found in 01-01, Task 3)
- ISS-006: Matcher does not strip URLs or @handles; 'https://x.com/jio_ipo' matches 'Jio IPO'; 03-01 triage should strip URLs first (found in 01-01, Task 3)
- ISS-007: Negative masking removes the 'jio' in 'khul ke jio IPO'; Hindi phrases dropped only when no co-occurrence term present (found in 01-01, Task 3)
- ISS-008: No code-reviewer subagent ran for 01-01 and 01-02; self-review only (found in 01-01, 01-02)
- ISS-009: Worker vitest globalSetup still reuses packages/db/test/global-setup.ts; 02-01 should switch to prepareTestDb('jio_ipo_test_worker') (found in 01-02, Task 1)
- ISS-010: effective_classifications is SELECT c.*, frozen at creation; new classifications columns need a migration recreating the view, and drizzle ALTERs may hit the dependency (found in 01-02, Task 1)
- ISS-011: After a lock expires one more wrong attempt re-locks at once while failures remain in the 30-minute lookback; stricter than plan, left as is (found in 01-03)
