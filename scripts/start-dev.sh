#!/bin/bash

# AI Chat Platform Backend 开发环境启动脚本

set -e

echo "🚀 AI Chat Platform Backend - 开发环境启动"
echo "=============================================="

# 检查 Node.js 版本
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装，请先安装 Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 版本过低，需要 18+，当前版本: $(node -v)"
    exit 1
fi

echo "✅ Node.js 版本检查通过: $(node -v)"

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    echo "⚠️ pnpm 未安装，使用 npm 替代"
    PKG_MANAGER="npm"
else
    echo "✅ pnpm 版本: $(pnpm -v)"
    PKG_MANAGER="pnpm"
fi

# 进入后端目录
cd packages/backend

# 检查环境变量文件
if [ ! -f .env ]; then
    echo "📝 创建环境变量文件..."
    cp .env.example .env
    echo "✅ 已创建 .env 文件，请根据需要修改配置"
fi

# 安装依赖
echo "📦 安装依赖包..."
if [ "$PKG_MANAGER" = "pnpm" ]; then
    pnpm install
else
    npm install
fi

# 生成 Prisma 客户端
echo "🗄️ 生成数据库客户端..."
if [ "$PKG_MANAGER" = "pnpm" ]; then
    pnpm run db:generate
else
    npm run db:generate
fi

# 初始化数据库
echo "🗃️ 初始化数据库..."
if [ "$PKG_MANAGER" = "pnpm" ]; then
    pnpm run db:push
else
    npm run db:push
fi

# 运行数据库初始化脚本
echo "🔧 初始化系统数据..."
if [ -f "node_modules/.bin/tsx" ]; then
    npx tsx ../scripts/init-db.ts
else
    node -r tsx/register ../scripts/init-db.ts
fi

echo ""
echo "🎉 后端服务准备完成！"
echo ""
echo "📍 服务地址: http://localhost:3001"
echo "📖 API 文档: http://localhost:3001/api"
echo "🏥 健康检查: http://localhost:3001/api/settings/health"
echo "🗄️ 数据库管理: pnpm run db:studio"
echo ""
echo "🚀 启动开发服务器..."
echo ""

# 启动开发服务器
if [ "$PKG_MANAGER" = "pnpm" ]; then
    pnpm run dev
else
    npm run dev
fi