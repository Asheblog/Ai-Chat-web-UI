#!/bin/bash
set -euo pipefail

# 说明：
# - 修复数据/日志卷权限到 backend(1001)
# - 若 /app/data/app.db 不存在则自动初始化数据库 (prisma db push)
# - 以 backend 用户启动应用

DATA_DIR="/app/data"
LOG_DIR="/app/logs"
DEFAULT_DB_NAME="app.db"

normalize_database_url() {
  local raw="${DATABASE_URL:-file:./data/$DEFAULT_DB_NAME}"

  if [[ "$raw" =~ ^file: ]]; then
    local path="${raw#file:}"
    if [[ "$path" = /* ]]; then
      DB_FILE="$path"
    else
      # 统一写入 DATA_DIR，避免相对路径落到 /app/prisma/data
      local filename
      filename="$(basename "$path")"
      DB_FILE="$DATA_DIR/${filename:-$DEFAULT_DB_NAME}"
      export DATABASE_URL="file:$DB_FILE"
    fi
  else
    echo "[entrypoint] WARN: Unsupported DATABASE_URL scheme ($raw). Falling back to file storage under $DATA_DIR/$DEFAULT_DB_NAME" >&2
    DB_FILE="$DATA_DIR/$DEFAULT_DB_NAME"
    export DATABASE_URL="file:$DB_FILE"
  fi
}

normalize_database_url

DB_DIR="$(dirname "$DB_FILE")"
mkdir -p "$DATA_DIR" "$LOG_DIR" "$DB_DIR" || true

# 修复卷权限（容器首次创建命名卷时可能为 root:root）
chown -R 1001:1001 "$DATA_DIR" "$LOG_DIR" || true
if [ "$DB_DIR" != "$DATA_DIR" ]; then
  chown -R 1001:1001 "$DB_DIR" || true
fi

SHOULD_INIT_DB=0

if [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] Database not found. Running prisma db push to initialize schema..."
  # 以 root 运行以避免写 @prisma/engines 权限问题，随后再修正卷属主
  if command -v npx >/dev/null 2>&1; then
    npx prisma generate || true
    npx prisma db push || npm run db:push || true
  else
    npm run db:push || true
  fi
  SHOULD_INIT_DB=1
fi

# 显式触发数据库初始化：DB_INIT_ON_START=true/TRUE/1 时无论数据库是否存在均执行
INIT_FLAG="$(printf '%s' "${DB_INIT_ON_START:-false}" | tr '[:upper:]' '[:lower:]')"
if [ "$INIT_FLAG" = "true" ] || [ "$INIT_FLAG" = "1" ]; then
  SHOULD_INIT_DB=1
fi

if [ "$SHOULD_INIT_DB" -eq 1 ]; then
  echo "[entrypoint] Running database initialization (npm run db:init)..."
  if ! npm run db:init; then
    echo "[entrypoint] WARN: db:init failed, falling back to npm run db:seed" >&2
    npm run db:seed || true
  fi
  # 再次修复权限，确保播种后新生成的文件归属 backend 用户
  chown -R 1001:1001 "$DATA_DIR" "$LOG_DIR" || true
fi

echo "[entrypoint] Starting backend service..."
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec backend:nodejs node dist/index.js
elif command -v gosu >/dev/null 2>&1; then
  exec gosu backend:nodejs node dist/index.js
else
  echo "[entrypoint] WARN: su-exec/gosu not found, running as root" >&2
  exec node dist/index.js
fi
