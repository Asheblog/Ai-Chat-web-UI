#!/bin/bash
set -euo pipefail

if command -v gosu >/dev/null 2>&1; then
  exec gosu nextjs "$@"
fi
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec nextjs "$@"
fi

echo "[run-as-frontend] WARN: gosu/su-exec not found, running as root" >&2
exec "$@"
