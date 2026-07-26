#!/bin/bash
set -euo pipefail

if command -v gosu >/dev/null 2>&1; then
  exec gosu backend "$@"
fi
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec backend "$@"
fi

echo "[run-as-backend] WARN: gosu/su-exec not found, running as root" >&2
exec "$@"
