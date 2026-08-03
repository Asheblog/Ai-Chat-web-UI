#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE="$ROOT/docker-compose.yml"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ -f "$COMPOSE" ]] || fail "missing $COMPOSE"

grep -qE '^[[:space:]]*app:' "$COMPOSE" || fail "docker-compose.yml must define service app"
grep -qE 'ghcr.io/.*/aichat:latest' "$COMPOSE" || fail "app image must be ghcr.io/<owner>/aichat:latest"
grep -qE 'docker-socket-proxy:' "$COMPOSE" || fail "docker-socket-proxy service required"
grep -qE 'ai_chat_web_ui_db_data' "$COMPOSE" || fail "must keep volume name ai_chat_web_ui_db_data"
! grep -qE '^[[:space:]]*rag-worker:' "$COMPOSE" || fail "default compose must not define rag-worker service"
! grep -qE '^[[:space:]]*frontend:' "$COMPOSE" || fail "default compose must not define frontend service"
! grep -qE '^[[:space:]]*backend:' "$COMPOSE" || fail "default compose must not define backend service"

[[ -f "$ROOT/docker/Dockerfile" ]] || fail "missing docker/Dockerfile"
[[ -f "$ROOT/docker/start-app.sh" ]] || fail "missing docker/start-app.sh"
grep -qE '^export CHAT_IMAGE_DIR=' "$ROOT/docker/start-app.sh" || fail "start-app.sh must export CHAT_IMAGE_DIR so supervisord children inherit it"
[[ -f "$ROOT/docker-compose.split.yml" ]] || fail "missing docker-compose.split.yml"

echo "OK: all-in-one compose layout looks correct"
