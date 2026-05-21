#!/usr/bin/env bash
# Bring up the PHP+MySQL+Redis stack for tests. Idempotent.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Load .env.test if present
if [ -f ".env.test" ]; then
  # Export all variables defined in .env.test
  set -a
  # shellcheck disable=SC1091
  . ./.env.test
  set +a
fi

STACK="${STACK:-docker}"

ensure_fastadmin_env() {
  # Write fastAdmin/.env so ThinkPHP's Env::get() picks up the test DB.
  local env_file="$ROOT_DIR/fastAdmin/.env"
  cat > "$env_file" <<EOF
[app]
debug = true
trace = false

[database]
type = mysql
hostname = ${DB_HOST_INTERNAL:-mysql}
database = ${DB_NAME:-fastadmin_test}
username = ${DB_USER:-fastadmin_test}
password = ${DB_PASSWORD:-fastadmin_test}
hostport = ${DB_PORT_INTERNAL:-3306}
prefix = ${DB_PREFIX:-fa_}
charset = utf8mb4
EOF
}

case "$STACK" in
  docker)
    echo "[start-server] docker mode"
    : "${DB_HOST_INTERNAL:=mysql}"
    : "${DB_PORT_INTERNAL:=3306}"
    ensure_fastadmin_env
    ( cd docker && docker-compose --env-file ../.env.test up -d --build )
    bash "$ROOT_DIR/scripts/wait-for-server.sh"
    ;;
  local)
    echo "[start-server] local mode (php -S)"
    : "${DB_HOST_INTERNAL:=${DB_HOST:-127.0.0.1}}"
    : "${DB_PORT_INTERNAL:=${DB_PORT:-3306}}"
    ensure_fastadmin_env
    # Kill any prior server on the same port.
    if lsof -ti tcp:8787 >/dev/null 2>&1; then
      lsof -ti tcp:8787 | xargs kill -9 2>/dev/null || true
    fi
    nohup php -S 127.0.0.1:8787 \
      -t "$ROOT_DIR/fastAdmin/public" \
      "$ROOT_DIR/fastAdmin/public/router.php" \
      > "$ROOT_DIR/scripts/.local-server.log" 2>&1 &
    echo $! > "$ROOT_DIR/scripts/.local-server.pid"
    bash "$ROOT_DIR/scripts/wait-for-server.sh"
    ;;
  *)
    echo "[start-server] unknown STACK=$STACK (expected: docker|local)" >&2
    exit 2
    ;;
esac

echo "[start-server] up at ${FASTADMIN_BASE_URL:-http://127.0.0.1:8787}"
