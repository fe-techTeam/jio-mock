#!/usr/bin/env bash
# Smoke test of the production build: login redirect, login page, sign-in, protected shell.
# Needs a built app (next build), the dev database up and seeded, and the root .env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
set -a
# shellcheck disable=SC1091
[ -f "$ROOT/.env" ] && . "$ROOT/.env"
set +a

PORT=3100
BASE="http://localhost:$PORT"
JAR="$(mktemp)"
LOG="$(mktemp)"
cd "$HERE/.."
./node_modules/.bin/next start -p "$PORT" >"$LOG" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -f "$JAR" "$LOG"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  curl -fs "$BASE/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fs "$BASE/api/health" >/dev/null || { echo "server did not start"; cat "$LOG"; exit 1; }

fail() { echo "smoke failed: $1"; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$BASE/")
case "$code" in "307 $BASE/login"*) ;; *) fail "GET / gave: $code" ;; esac

page=$(curl -s -w '\n%{http_code}' "$BASE/login")
[ "$(echo "$page" | tail -1)" = "200" ] || fail "GET /login not 200"
echo "$page" | grep -q "Access is logged" || fail "login page missing footer"

body=$(jq -n --arg e "${SEED_USER_EMAIL:-strategy@jio.local}" --arg p "${SEED_USER_PASSWORD:?SEED_USER_PASSWORD is empty}" '{email:$e,password:$p}')
code=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -X POST "$BASE/api/auth/sign-in/email" \
  -H 'content-type: application/json' -H "Origin: $BASE" -d "$body")
[ "$code" = "200" ] || fail "sign-in gave $code"

home=$(curl -s -w '\n%{http_code}' -b "$JAR" "$BASE/")
[ "$(echo "$home" | tail -1)" = "200" ] || fail "GET / with session not 200"
echo "$home" | grep -q "Collecting" || fail "shell missing empty state"

echo "smoke ok"
