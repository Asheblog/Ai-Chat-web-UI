#!/bin/bash
set -euo pipefail

# 前端镜像构建期 rewrites 目标主机名为 backend；all-in-one 内指回本机
if ! grep -qE '(^|[[:space:]])backend([[:space:]]|$)' /etc/hosts; then
  echo '127.0.0.1 backend' >> /etc/hosts
fi

# all-in-one 入口：先复用 backend 初始化（DB/权限/skills），再由 supervisord 托管三进程
# CHAT_IMAGE_DIR 必须显式导出，否则 supervisord 托管的 backend 会落入 cwd 相对路径
# （/app/packages/backend/storage/chat-images，临时层），头像/聊天图片写不进挂载卷
export CHAT_IMAGE_DIR="${CHAT_IMAGE_DIR:-/app/storage/chat-images}"
export APP_INIT_ONLY=1
/usr/local/bin/start-backend.sh --init-only

echo "[start-app] Launching supervisord (backend + rag-worker + frontend)..."
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/aichat.conf
