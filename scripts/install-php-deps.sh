#!/usr/bin/env bash
# Ensure fastAdmin/vendor/ is populated. The repo ships with vendor included, so
# this is mostly a safety net for fresh clones.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/fastAdmin"

if [ ! -d vendor/topthink/framework ]; then
  if command -v composer >/dev/null 2>&1; then
    composer install --no-interaction --no-progress --no-dev
  else
    echo "[install-php-deps] composer not found and vendor/ missing" >&2
    exit 2
  fi
else
  echo "[install-php-deps] vendor/ already populated, skipping"
fi
