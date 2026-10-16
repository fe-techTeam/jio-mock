# v0.1 Issues

Deferred enhancements and known gaps, numbered ISS-NNN. Add new ones at the bottom: `ISS-NNN: <one line> (found in NN-MM, Task N)`.

- ISS-001: Spike and negative-shift alerts (email, Slack, WhatsApp) deferred by developer decision (found in design)
- ISS-002: Deploy to Vercel, Fly.io and Supabase Mumbai not run in v0.1; local only (found in design)
- ISS-003: pgboss.queue holds 7 rows (6 contract queues plus internal __pgboss__send-it); plan's 6-row check is inexact (found in 00-03)
