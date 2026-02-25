#!/bin/bash
set -euo pipefail

# 说明：
# - 修复数据/日志卷权限到 backend(1001)
# - 若 /app/data/app.db 不存在则自动初始化数据库 (prisma db push)
# - 以 backend 用户启动应用

# 应用根目录（保持与 pnpm workspace 同步）
APP_ROOT="/app/packages/backend"
DATA_DIR="/app/data"
LOG_DIR="/app/logs"
DEFAULT_DB_NAME="app.db"
IMAGE_DIR_DEFAULT="/app/storage/chat-images"
RESTORE_USER_PROFILE_MIGRATION_NAME="20260222183000_restore_user_profile_columns"
DOCKER_SOCKET_PATH="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

cd "$APP_ROOT"

configure_docker_socket_access() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "[entrypoint] WARN: docker CLI 不存在，workspace 沙箱 Python 将不可用" >&2
    return 0
  fi

  if [ ! -S "$DOCKER_SOCKET_PATH" ]; then
    echo "[entrypoint] WARN: Docker socket 未挂载（$DOCKER_SOCKET_PATH），workspace 沙箱 Python 将不可用" >&2
    return 0
  fi

  local socket_gid
  socket_gid="$(stat -c '%g' "$DOCKER_SOCKET_PATH" 2>/dev/null || true)"
  if [ -z "$socket_gid" ]; then
    echo "[entrypoint] WARN: 无法读取 Docker socket gid，workspace 沙箱 Python 可能不可用" >&2
    return 0
  fi

  local socket_group
  socket_group="$(getent group "$socket_gid" | cut -d: -f1 || true)"
  if [ -z "$socket_group" ]; then
    socket_group="dockersock"
    groupadd -g "$socket_gid" "$socket_group" >/dev/null 2>&1 || true
  fi

  if ! id -nG backend | tr ' ' '\n' | grep -Fxq "$socket_group"; then
    usermod -a -G "$socket_group" backend >/dev/null 2>&1 || true
  fi

  echo "[entrypoint] Docker socket group: gid=$socket_gid name=$socket_group"
}

verify_workspace_docker_ready() {
  if ! command -v docker >/dev/null 2>&1; then
    return 0
  fi
  if [ ! -S "$DOCKER_SOCKET_PATH" ]; then
    return 0
  fi

  local verifier=""
  if command -v su-exec >/dev/null 2>&1; then
    verifier="su-exec backend"
  elif command -v gosu >/dev/null 2>&1; then
    verifier="gosu backend"
  fi

  if [ -z "$verifier" ]; then
    echo "[entrypoint] WARN: 无法切换到 backend 用户验证 Docker 权限，请手动检查" >&2
    return 0
  fi

  if sh -c "$verifier docker version --format '{{.Server.Version}}' >/dev/null 2>&1"; then
    echo "[entrypoint] Workspace Docker readiness check passed"
  else
    echo "[entrypoint] WARN: backend 用户无法访问 Docker，请检查 /var/run/docker.sock 权限" >&2
  fi
}

configure_docker_socket_access
verify_workspace_docker_ready

if [ -z "${CHAT_IMAGE_DIR:-}" ]; then
  export CHAT_IMAGE_DIR="$IMAGE_DIR_DEFAULT"
  echo "[entrypoint] CHAT_IMAGE_DIR 未设置，已默认指向 $CHAT_IMAGE_DIR"
fi

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
mkdir -p "$DATA_DIR" "$LOG_DIR" "$DB_DIR" "$CHAT_IMAGE_DIR" || true

# 修复卷权限（容器首次创建命名卷时可能为 root:root）
chown -R 1001:1001 "$DATA_DIR" "$LOG_DIR" "$CHAT_IMAGE_DIR" || true
if [ "$DB_DIR" != "$DATA_DIR" ]; then
  chown -R 1001:1001 "$DB_DIR" || true
fi

SHOULD_INIT_DB=0
PRISMA_SCHEMA_PATH="${PRISMA_SCHEMA_PATH:-$APP_ROOT/prisma/schema.prisma}"
PRISMA_BIN="$APP_ROOT/node_modules/.bin/prisma"

run_prisma_command() {
  local subcommand="$1"
  shift || true

  if command -v npx >/dev/null 2>&1; then
    npx prisma "$subcommand" "$@" || return $?
    return 0
  fi

  if [ -x "$PRISMA_BIN" ]; then
    "$PRISMA_BIN" "$subcommand" "$@" || return $?
    return 0
  fi

  echo "[entrypoint] ERROR: Prisma CLI not found (npx/prisma). Please ensure dependencies are installed." >&2
  return 1
}

run_prisma_generate() {
  run_prisma_command "generate" --schema "$PRISMA_SCHEMA_PATH" || true
}

run_prisma_migrate_deploy() {
  run_prisma_command "migrate" "deploy" --schema "$PRISMA_SCHEMA_PATH"
}

sqlite_table_exists() {
  local table_name="$1"
  local exists
  exists="$(sqlite3 "$DB_FILE" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='${table_name}' LIMIT 1;" 2>/dev/null || true)"
  [ "$exists" = "1" ]
}

sqlite_table_has_column() {
  local table_name="$1"
  local column_name="$2"
  local exists
  exists="$(sqlite3 "$DB_FILE" "SELECT 1 FROM pragma_table_info('${table_name}') WHERE name='${column_name}' LIMIT 1;" 2>/dev/null || true)"
  [ "$exists" = "1" ]
}

ensure_restore_user_profile_columns() {
  # 新库由 migration 负责；已有库做幂等补列，避免历史缺陷导致启动后 P2022。
  if [ ! -f "$DB_FILE" ]; then
    return 0
  fi

  if ! sqlite_table_exists "users"; then
    return 0
  fi

  if ! sqlite_table_has_column "users" "avatar_path"; then
    echo "[entrypoint] Patching schema: add users.avatar_path"
    sqlite3 "$DB_FILE" 'ALTER TABLE "users" ADD COLUMN "avatar_path" TEXT;'
  fi

  if ! sqlite_table_has_column "users" "personalPrompt"; then
    echo "[entrypoint] Patching schema: add users.personalPrompt"
    sqlite3 "$DB_FILE" 'ALTER TABLE "users" ADD COLUMN "personalPrompt" TEXT;'
  fi
}

should_resolve_restore_user_profile_migration() {
  if [ ! -f "$DB_FILE" ]; then
    return 1
  fi

  if ! sqlite_table_exists "_prisma_migrations"; then
    return 1
  fi

  if ! sqlite_table_has_column "users" "avatar_path"; then
    return 1
  fi

  if ! sqlite_table_has_column "users" "personalPrompt"; then
    return 1
  fi

  local tracked
  tracked="$(sqlite3 "$DB_FILE" "SELECT 1 FROM \"_prisma_migrations\" WHERE migration_name='${RESTORE_USER_PROFILE_MIGRATION_NAME}' LIMIT 1;" 2>/dev/null || true)"
  [ "$tracked" = "1" ]
}

try_resolve_restore_user_profile_migration() {
  echo "[entrypoint] Attempting to resolve ${RESTORE_USER_PROFILE_MIGRATION_NAME} as applied..."
  run_prisma_command "migrate" "resolve" --applied "$RESTORE_USER_PROFILE_MIGRATION_NAME" --schema "$PRISMA_SCHEMA_PATH"
}

run_as_backend() {
  if command -v su-exec >/dev/null 2>&1; then
    su-exec backend "$@"
    return 0
  fi
  if command -v gosu >/dev/null 2>&1; then
    gosu backend "$@"
    return 0
  fi
  "$@"
}

if [ ! -f "$DB_FILE" ]; then
  echo "[entrypoint] Database not found. Will initialize schema and seed data..."
  SHOULD_INIT_DB=1
fi

run_prisma_generate

if ! ensure_restore_user_profile_columns; then
  echo "[entrypoint] WARN: pre-migrate schema patch failed; continuing with migrate deploy" >&2
fi

if ! run_prisma_migrate_deploy; then
  if should_resolve_restore_user_profile_migration && try_resolve_restore_user_profile_migration && run_prisma_migrate_deploy; then
    echo "[entrypoint] Migration deploy recovered after resolving ${RESTORE_USER_PROFILE_MIGRATION_NAME}"
  else
    echo "[entrypoint] WARN: prisma migrate deploy failed, falling back to prisma db push" >&2
    run_prisma_command "db" "push" --schema "$PRISMA_SCHEMA_PATH" || npm run db:push || true
  fi
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
  chown -R 1001:1001 "$DATA_DIR" "$LOG_DIR" "$CHAT_IMAGE_DIR" || true
fi

echo "[entrypoint] Syncing builtin skills (npm run db:sync-builtins)..."
run_as_backend npm run db:sync-builtins

RECONCILE_ON_START_FLAG="$(printf '%s' "${PYTHON_RUNTIME_RECONCILE_ON_START:-true}" | tr '[:upper:]' '[:lower:]')"
if [ "$RECONCILE_ON_START_FLAG" = "true" ] || [ "$RECONCILE_ON_START_FLAG" = "1" ]; then
  echo "[entrypoint] Reconciling managed Python runtime (npm run python-runtime:reconcile)..."
  if ! run_as_backend npm run python-runtime:reconcile; then
    echo "[entrypoint] WARN: Python runtime reconcile failed; service will continue. You can retry via System Settings -> Python 运行环境 -> Reconcile." >&2
  fi
else
  echo "[entrypoint] Skip Python runtime reconcile on start (PYTHON_RUNTIME_RECONCILE_ON_START=$RECONCILE_ON_START_FLAG)"
fi

echo "[entrypoint] Starting backend service..."
if command -v su-exec >/dev/null 2>&1; then
  exec su-exec backend node dist/index.js
elif command -v gosu >/dev/null 2>&1; then
  exec gosu backend node dist/index.js
else
  echo "[entrypoint] WARN: su-exec/gosu not found, running as root" >&2
  exec node dist/index.js
fi
