#!/usr/bin/env bash
# Block until the FastAdmin HTTP server is serving 2xx/3xx/404 (i.e. PHP is up).
# A 200 on /admin/index/login.html is the strongest signal; 404 still means PHP is
# responding (just not installed yet), which is fine for the seed step that follows.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f ".env.test" ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.test
  set +a
fi

BASE="${FASTADMIN_BASE_URL:-http://127.0.0.1:8787}"
DEADLINE=$(( $(date +%s) + 60 ))

while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/" || echo "000")"
  case "$code" in
    200|301|302|303|307|308|404|500)
      echo "[wait-for-server] up ($code) at $BASE"
      exit 0
      ;;
  esac
  sleep 1
done

echo "[wait-for-server] timeout waiting for $BASE" >&2
exit 1
