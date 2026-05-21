#!/usr/bin/env bash
# Bring down the test stack. Idempotent.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ".env.test" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.test
  set +a
fi

STACK="${STACK:-docker}"

case "$STACK" in
  docker)
    ( cd docker && docker-compose --env-file ../.env.test down -v )
    ;;
  local)
    if [ -f "$ROOT_DIR/scripts/.local-server.pid" ]; then
      pid="$(cat "$ROOT_DIR/scripts/.local-server.pid")"
      kill -9 "$pid" 2>/dev/null || true
      rm -f "$ROOT_DIR/scripts/.local-server.pid"
    fi
    # Best-effort cleanup of orphaned listeners on 8787.
    if lsof -ti tcp:8787 >/dev/null 2>&1; then
      lsof -ti tcp:8787 | xargs kill -9 2>/dev/null || true
    fi
    ;;
  *)
    echo "[stop-server] unknown STACK=$STACK" >&2
    exit 2
    ;;
esac

echo "[stop-server] down"
