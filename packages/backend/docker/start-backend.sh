#!/bin/bash
set -euo pipefail

# 说明：
# - 修复数据/日志卷权限到 backend(1001)
# - 若 /app/data/app.db 不存在则自动初始化数据库 (prisma db push)
# - 以 backend 用户启动应用

DATA_DIR="/app/data"
LOG_DIR="/app/logs"
DB_FILE="$DATA_DIR/app.db"

mkdir -p "$DATA_DIR" "$LOG_DIR" || true

# 修复卷权限（容器首次创建命名卷时可能为 root:root）
chown -R 1001:1001 "$DATA_DIR" "$LOG_DIR" || true

if [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] Database not found. Running prisma db push to initialize schema..."
  # 以 root 运行以避免写 @prisma/engines 权限问题，随后再修正卷属主
  if command -v npx >/dev/null 2>&1; then
    npx prisma generate || true
    npx prisma db push || npm run db:push || true
  else
    npm run db:push || true
  fi
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
