#!/usr/bin/env bash
# Serialises pnpm across parallel executors (mkdir lock; macOS has no flock).
set -euo pipefail
LOCK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.pnpm-exec.lock"
waited=0
until mkdir "$LOCK" 2>/dev/null; do
  if [ "$waited" -ge 300 ]; then
    echo "pnpm-locked: timed out waiting for $LOCK" >&2
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
# Old corepack builds fail npm signature checks; skip them (pnpm version is pinned by packageManager).
export COREPACK_INTEGRITY_KEYS="${COREPACK_INTEGRITY_KEYS:-0}"
corepack pnpm "$@"
