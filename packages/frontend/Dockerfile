# 使用轻量级的Node.js镜像进行构建
FROM node:20-alpine AS base

# 安装构建依赖
RUN apk add --no-cache \
    libc6-compat \
    python3 \
    make \
    g++

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# 检测使用pnpm还是npm
RUN if [ -f pnpm-lock.yaml ]; then \
        npm install -g pnpm; \
    fi

# 依赖安装阶段
FROM base AS deps

# 设置环境变量优化Next.js构建
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# 安装依赖
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    fi

# 构建阶段
FROM base AS builder

# 设置构建环境变量
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS="--max-old-space-size=4096"

# 复制依赖
COPY --from=deps /app/node_modules ./node_modules

# 复制源代码
COPY . .

# 设置构建参数
ARG NEXT_PUBLIC_API_URL=http://localhost:8001/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# 生成Prisma客户端（如果需要）
# RUN npm run db:generate

# 构建应用
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm run build; \
    else \
        npm run build; \
    fi

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

# 复制package文件
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# 只安装生产依赖
RUN if [ -f pnpm-lock.yaml ]; then \
        npm install -g pnpm && \
        pnpm install --frozen-lockfile --prod && \
        pnpm store prune; \
    else \
        if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
        npm cache clean --force && \
        rm -rf ~/.npm; \
    fi

# 复制构建产物
COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static

# 创建必要的目录
RUN mkdir -p /app/.next/cache && \
    chown -R nextjs:nextjs /app/.next

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

# 启动应用（使用standalone构建）
CMD ["node", "server.js"]

# 开发阶段（可选）
FROM base AS development

# 设置开发环境变量
ENV NODE_ENV=development

# 安装所有依赖
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    fi

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动开发服务器
CMD ["dumb-init", "npm", "run", "dev"]
