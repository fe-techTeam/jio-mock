---
phase: 01-data-and-login
plan: 03
requires:
  - { phase: 01-data-and-login, provides: [auth tables, logEvent, loginFailuresSince, prepareTestDb, db:seed chain] }
  - { phase: 00-foundation, provides: [Next web app, Vitest split, shadcn setup, pnpm-locked.sh] }
provides:
  - "auth (lib/auth.ts, lazy proxy over createAuth), createAuth({db, allowSignUp?, secret?, baseURL?}), authClient (lib/auth-client.ts), getDb() (lib/db.ts, globalThis singleton)"
  - "requireSession() in lib/session.ts: validates the DB session, redirects to /login (reason=expired when a cookie was present), logs a view event. Every (app) layout must call it"
  - "createAuthRouteHandlers({auth, db, now}) in lib/auth-route.ts: sign-up 404, lockout 429 ACCOUNT_LOCKED after 5 failures in 15 min, login/login_failed/login_locked/logout events; wired at /api/auth/[...all]"
  - "lockoutState, clientIp (lib/login-guard.ts); safeNext (lib/safe-next.ts)"
  - "middleware.ts: cookie check, /login + /api/auth/* + /api/health public, 401 JSON for other /api, sets x-pathname"
  - "Login page (labels Email and Password, button Sign in, footer 'Access is logged', ?reason=expired alert), (app) shell with SignOutButton, empty state 'Collecting: ...'"
  - "seedUser/SeedUserError, `seed:user` script (called by db:seed), apps/web/scripts/smoke-login.sh"
  - "shadcn card, input, label, badge, alert"
affects: [04-01, 04-02, 05-01, 05-02, 05-03, 07-02]
key_files:
  - apps/web/src/lib/auth.ts
  - apps/web/src/lib/auth-route.ts
  - apps/web/src/lib/session.ts
  - apps/web/src/lib/login-guard.ts
  - apps/web/src/middleware.ts
  - apps/web/src/app/login/login-form.tsx
  - apps/web/src/app/(app)/layout.tsx
  - apps/web/scripts/smoke-login.sh
key_decisions:
  - "Lockout lives on the auth HTTP route, not the form: covers direct API calls (07-02)"
  - "auth is a lazy Proxy (with get and has traps) so importing it needs no DATABASE_URL"
  - "Seed updates passwords via auth.$context.internalAdapter, avoiding a second drizzle-orm copy"
issues_created: []
completed: 2026-10-16
---

# 01-03: Single login with lockout and protected shell

**Better Auth email/password login on the @jio/db tables, a guarded auth route (no sign-up, 15-minute lock after 5 failures, full login audit), cookie middleware, a login page and an empty protected `/` shell, with an idempotent `pnpm db:seed` user.**

## Accomplishments

- Seed user created or password-reset by `pnpm db:seed` (exactly one `user` row on reruns).
- Raw HTTP lockout verified with injected clock; 6th attempt gets 429 ACCOUNT_LOCKED with Retry-After.
- `smoke-login.sh` prints "smoke ok" against `next start` and leaves nothing on 3100; event_log shows login and view rows.

## Task commits

1. Task 1: Better Auth server, client and seed user - `422aad1` (feat)
2. Task 2: Guarded auth route with lockout and login audit - `b5a5af8` (feat)
3. Task 3: Middleware, login page and protected shell - `8cb4acb` (feat)

## Decisions

- Lockout on the HTTP route; event kinds login_locked and logout were already in EventKind (added in 01-01/01-02), used here.
- Local BETTER_AUTH_SECRET and SEED_USER_PASSWORD were generated into the gitignored root .env (were empty).
- A further wrong attempt after a lock expires re-locks at once while the earlier failures are still in the 30-minute lookback (stricter, left as is).
- Lock message minutes are computed from remaining time, rounded up (15 only when tried at the 5th failure).

## Deviations from plan

### Auto-fixed
- **[Rule 3 - blocker] next build could not bundle `@jio/db`: `new URL('../migrations', import.meta.url)` in packages/db/src/migrate.ts** - fix: path.resolve/dirname form (outside declared files, one line); verified by build and 51 db tests.
- **[Rule 1 - bug] Proxy `auth` lacked a `has` trap, so toNextJsHandler's `'handler' in auth` failed and sign-in gave 500 in the built app** - found by smoke; fix: has trap; verified by smoke ok.
- **[Rule 3] shadcn CLI again generated imports from junk `cn` / `radix-ui`** - fix: imports to `@/lib/utils` and `@radix-ui/react-slot`, plain `<label>`; both packages removed from package.json.
- **[Rule 1] apps/web/e2e/health.spec.ts asserted the deleted placeholder** - fix: now asserts GET / redirects (307) to /login. Not in files_modified but required.
- drizzle-orm not added to web (two copies broke types); `internalAdapter` used instead.

### Deferred to ISSUES.md
- None.

## Verification

- Tests: `corepack pnpm test` -> core 117, db 51, worker 8, web 42 passed
- Build / types / lint: `next build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` PASS; smoke-login.sh "smoke ok"; port 3100 clear

## Next-phase readiness

- Route tests mock `auth.api.getSession` from `@/lib/auth`; 04-02 replaces (app)/layout.tsx and page.tsx but must keep `requireSession()`.
- Sign out via `authClient.signOut()`; the e2e spec for GET / expects a 307 to /login.
- 07-02 can POST `/api/auth/sign-in/email` (Origin header required) and hit the lockout by the sixth attempt.
- Integration tests use DB `jio_ipo_test_web`.
