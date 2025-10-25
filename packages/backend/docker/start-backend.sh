#!/bin/sh
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
  # 使用 npx 调用 Prisma CLI（prisma 放在 dependencies，可在生产镜像中使用）
  # 以 backend 用户运行，确保 DB 文件属主正确
  if command -v npx >/dev/null 2>&1; then
    su-exec backend:nodejs npx prisma db push || su-exec backend:nodejs npm run db:push || true
  else
    su-exec backend:nodejs npm run db:push || true
  fi
fi

echo "[entrypoint] Starting backend service..."
exec su-exec backend:nodejs node dist/index.js

