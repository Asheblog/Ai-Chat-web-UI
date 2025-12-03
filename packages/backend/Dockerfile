# 使用稳定的 Debian Slim Node.js 镜像，避免 musl + OpenSSL 兼容问题
FROM node:20-slim AS base

# 基础镜像阶段仅做系统依赖与依赖安装，不限制 Node 堆内存，避免安装阶段内存不足
ENV NODE_ENV=production
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
ENV DATABASE_URL="file:/app/data/app.db"

# 安装必要的系统依赖（最小化安装）
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        sqlite3 \
        curl \
        dumb-init \
        python3 \
        python3-venv \
        python3-pip \
        python3-numpy \
        python3-sympy \
        python3-scipy \
        python3-matplotlib \
        python3-pandas \
        openssl \
        ca-certificates \
        gosu \
    && rm -rf /var/lib/apt/lists/*

# 启用 corepack 并固定 pnpm 版本，确保锁文件兼容
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# 设置工作目录
WORKDIR /app

# 复制 workspace 元数据（仅 package.json 与 lock 文件，用于缓存依赖安装层）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/shared/package.json packages/shared/
COPY packages/shared ./packages/shared
RUN mkdir -p /app/data

# 开发阶段
FROM base AS development

# 安装依赖需要完整开发环境
ENV NODE_ENV=development

# 安装所有依赖
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY packages ./packages

# 切换到 backend 包目录运行脚本
WORKDIR /app/packages/backend

# 生成Prisma客户端
RUN pnpm run db:generate

# 暴露端口
EXPOSE 8001

# 启动开发服务器
CMD ["dumb-init", "npm", "run", "dev"]

# 生产构建阶段
FROM base AS build

# 构建阶段需要开发依赖（TypeScript 等）
ENV NODE_ENV=development

# 安装所有依赖（包括开发依赖用于构建）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY packages ./packages

WORKDIR /app/packages/backend

# 生成Prisma客户端
RUN pnpm run db:generate

# 构建TypeScript
RUN pnpm run build

# 生产阶段 - 优化内存占用
FROM node:20-slim AS production

# 优化Node.js运行时内存设置（移除 --optimize-for-size，避免 NODE_OPTIONS 限制报错）
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV NODE_ENV=production
ENV PRISMA_CLI_BINARY_TARGETS="debian-openssl-3.0.x"
ENV DATABASE_URL="file:/app/data/app.db"

# 只安装运行时必需的系统依赖
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        sqlite3 \
        curl \
        dumb-init \
        python3 \
        python3-venv \
        python3-pip \
        python3-numpy \
        python3-sympy \
        python3-scipy \
        python3-matplotlib \
        python3-pandas \
        gosu \
        openssl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 创建非root用户（安全性）
RUN groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --system --no-create-home backend

# 设置工作目录
WORKDIR /app

# 保留 workspace 依赖结构，避免 pnpm 软链失效
COPY --from=build --chown=backend:nodejs /app/node_modules /app/node_modules
COPY --from=build --chown=backend:nodejs /app/pnpm-workspace.yaml /app/pnpm-workspace.yaml
COPY --from=build --chown=backend:nodejs /app/packages/shared /app/packages/shared
COPY --from=build --chown=backend:nodejs /app/packages/backend /app/packages/backend

# 创建数据和日志目录
RUN mkdir -p /app/data /app/logs && \
    chown -R backend:nodejs /app/data /app/logs

# 复制启动脚本（以 root 运行修复权限，随后降权运行）
COPY --chown=backend:nodejs packages/backend/docker/start-backend.sh /usr/local/bin/start-backend.sh
RUN chmod +x /usr/local/bin/start-backend.sh

# 运行期以 root 进入，entrypoint 内会降权到 backend 用户
USER root

# 暴露端口
EXPOSE 8001

# 健康检查（轻量级）——与服务端实际路由保持一致
# 注意：后端健康检查路由为 /api/settings/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8001/api/settings/health > /dev/null || exit 1

# 使用dumb-init作为PID 1，优化信号处理和内存
ENTRYPOINT ["dumb-init", "--"]

# 启动应用（入口脚本会做权限修复与DB初始化，然后降权）
CMD ["/usr/local/bin/start-backend.sh"]
