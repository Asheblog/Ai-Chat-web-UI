# 使用轻量级的Node.js镜像进行构建
FROM node:20-alpine AS base

# 安装构建依赖
RUN apk add --no-cache \
    libc6-compat \
    python3 \
    make \
    g++

# 启用 corepack 并锁定 pnpm 版本
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# 设置工作目录
WORKDIR /app

# 复制 workspace 元数据，提前包含 shared 包以支持 workspace:*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/shared/package.json packages/shared/
COPY packages/shared ./packages/shared

# 依赖安装阶段
FROM base AS deps

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

# 安装 workspace 依赖
RUN pnpm install --frozen-lockfile

# 构建阶段
FROM base AS builder

# 设置构建环境变量
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV BRANDING_FETCH_DISABLED=1

# 复制依赖与源代码
COPY --from=deps /app/node_modules ./node_modules
COPY packages ./packages

# 重新链接前端所需依赖，确保工作区软链未被覆盖
RUN pnpm install --frozen-lockfile --filter @aichat/frontend... --prod=false

WORKDIR /app/packages/frontend

# 设置构建参数（浏览器端 API 基址默认相对路径；服务端反代目标用于 Next rewrites）
ARG NEXT_PUBLIC_API_URL=/api
ARG BACKEND_HOST=localhost
ARG BACKEND_INTERNAL_PORT=8001
# 稳定的 Server Actions 加密密钥，避免重新构建后旧客户端调用失败
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=aichat-stable-server-actions-key-2025
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV BACKEND_HOST=$BACKEND_HOST
ENV BACKEND_INTERNAL_PORT=$BACKEND_INTERNAL_PORT
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

# 生成Prisma客户端（如果需要）
# RUN npm run db:generate

# 构建应用
RUN pnpm run build

# 运行阶段 - 最小化镜像
FROM node:20-alpine AS runner

# 设置运行时环境变量
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=128"
ENV PORT=3000

# 安装运行时依赖（最小化）
RUN apk add --no-cache \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# 创建非root用户
RUN addgroup -g 1001 -S nextjs && \
    adduser -S nextjs -u 1001

# 设置工作目录
WORKDIR /app

# 不在运行阶段再次安装依赖：Next.js standalone 已包含所需 node_modules，避免 CI 内存不足（exit 134）

# 复制构建产物（保持与monorepo目录一致，避免 Next.js 找不到 .next/static）
COPY --from=builder --chown=nextjs:nextjs /app/packages/frontend/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/packages/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/packages/frontend/.next/static ./packages/frontend/.next/static

# 创建 Next.js 运行期缓存目录
RUN mkdir -p /app/packages/frontend/.next/cache && \
    chown -R nextjs:nextjs /app/packages/frontend/.next

# 切换到非root用户
USER nextjs

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# 使用dumb-init作为PID 1
ENTRYPOINT ["dumb-init", "--"]

# 启动应用（使用standalone构建，monorepo 输出位于 packages/frontend/server.js）
CMD ["node", "packages/frontend/server.js"]

# 开发阶段（可选）
FROM base AS development

ENV NODE_ENV=development

RUN pnpm install --frozen-lockfile

COPY packages ./packages

WORKDIR /app/packages/frontend

EXPOSE 3000

CMD ["dumb-init", "pnpm", "run", "dev"]
