# 使用超轻量级的Node.js镜像，优化内存占用
FROM node:20-alpine AS base

# 设置环境变量优化Node.js内存使用
ENV NODE_OPTIONS="--max-old-space-size=256"
ENV NODE_ENV=production

# 安装必要的系统依赖（最小化安装）
RUN apk add --no-cache \
    sqlite \
    curl \
    dumb-init

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package.json pnpm-lock.yaml* package-lock.json* ./

# 检测使用pnpm还是npm
RUN if [ -f pnpm-lock.yaml ]; then \
        # 使用pnpm（更节省内存和空间）
        npm install -g pnpm && \
        pnpm install --frozen-lockfile --prod && \
        pnpm store prune; \
    else \
        # 使用npm（无锁文件时回退到 npm install）
        if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
        npm cache clean --force; \
    fi

# 开发阶段
FROM base AS development

# 安装所有依赖
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    fi

# 复制源代码
COPY . .

# 生成Prisma客户端
RUN npm run db:generate

# 暴露端口
EXPOSE 8001

# 启动开发服务器
CMD ["dumb-init", "npm", "run", "dev"]

# 生产构建阶段
FROM base AS build

# 安装所有依赖（包括开发依赖用于构建）
RUN if [ -f pnpm-lock.yaml ]; then \
        pnpm install --frozen-lockfile; \
    else \
        if [ -f package-lock.json ]; then npm ci; else npm install; fi; \
    fi

# 复制源代码
COPY . .

# 生成Prisma客户端
RUN npm run db:generate

# 构建TypeScript
RUN npm run build

# 生产阶段 - 优化内存占用
FROM node:20-alpine AS production

# 优化Node.js运行时内存设置
ENV NODE_OPTIONS="--max-old-space-size=256 --optimize-for-size"
ENV NODE_ENV=production

# 只安装运行时必需的系统依赖
RUN apk add --no-cache \
    sqlite \
    curl \
    dumb-init \
    && rm -rf /var/cache/apk/*

# 创建非root用户（安全性）
RUN addgroup -g 1001 -S nodejs && \
    adduser -S backend -u 1001

# 设置工作目录
WORKDIR /app

# 复制package文件并安装生产依赖（确保最小依赖）
COPY package.json pnpm-lock.yaml* package-lock.json* ./

RUN if [ -f pnpm-lock.yaml ]; then \
        npm install -g pnpm && \
        pnpm install --frozen-lockfile --prod && \
        pnpm store prune; \
    else \
        if [ -f package-lock.json ]; then npm ci --only=production; else npm install --only=production; fi && \
        npm cache clean --force && \
        rm -rf ~/.npm; \
    fi

# 复制构建产物和必要文件
COPY --from=build --chown=backend:nodejs /app/dist ./dist
COPY --from=build --chown=backend:nodejs /app/prisma ./prisma
COPY --from=build --chown=backend:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# 创建数据和日志目录
RUN mkdir -p /app/data /app/logs && \
    chown -R backend:nodejs /app/data /app/logs

# 切换到非root用户
USER backend

# 暴露端口
EXPOSE 8001

# 健康检查（轻量级）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8001/api/health || exit 1

# 使用dumb-init作为PID 1，优化信号处理和内存
ENTRYPOINT ["dumb-init", "--"]

# 启动应用
CMD ["node", "dist/index.js"]
