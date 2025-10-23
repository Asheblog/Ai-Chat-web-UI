#!/bin/bash

# =======================================================
# 数据库初始化脚本
# 用于创建数据库表结构和初始数据
# =======================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/packages/backend"

# 检查后端目录
if [ ! -d "$BACKEND_DIR" ]; then
    log_error "找不到后端目录: $BACKEND_DIR"
    exit 1
fi

# 进入后端目录
cd "$BACKEND_DIR"

# 检查Prisma schema文件
if [ ! -f "prisma/schema.prisma" ]; then
    log_error "找不到Prisma schema文件: prisma/schema.prisma"
    exit 1
fi

log_info "开始初始化数据库..."

# 检查环境变量
if [ -z "$DATABASE_URL" ]; then
    export DATABASE_URL="file:./data/dev.db"
    log_warning "未设置DATABASE_URL，使用默认值: $DATABASE_URL"
fi

# 创建数据目录
mkdir -p "$(dirname "$(echo "$DATABASE_URL" | sed 's/^file://')")"

# 生成Prisma客户端
log_info "生成Prisma客户端..."
if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
    pnpm db:generate
else
    npm run db:generate
fi

# 推送数据库schema
log_info "创建数据库表结构..."
if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
    pnpm db:push
else
    npm run db:push
fi

# 运行数据库迁移（如果有迁移文件）
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations)" ]; then
    log_info "运行数据库迁移..."
    if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
        pnpm db:migrate deploy
    else
        npx prisma migrate deploy
    fi
fi

# 创建初始数据的脚本
log_info "创建初始数据..."

# 创建一个临时脚本来插入初始数据
cat > temp_init_data.js << 'EOF'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('开始创建初始数据...');

    // 获取环境变量
    const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456';
    const appMode = process.env.APP_MODE || 'single';
    const defaultContextTokenLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000');

    try {
        // 检查是否已有管理员用户
        const existingAdmin = await prisma.user.findFirst({
            where: { role: 'ADMIN' }
        });

        if (!existingAdmin) {
            // 创建默认管理员用户
            const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10);

            const admin = await prisma.user.create({
                data: {
                    username: defaultAdminUsername,
                    hashedPassword: hashedPassword,
                    role: 'ADMIN'
                }
            });

            console.log(`✅ 创建管理员用户: ${admin.username}`);
        } else {
            console.log(`ℹ️  管理员用户已存在: ${existingAdmin.username}`);
        }

        // 创建系统设置
        const defaultSettings = [
            {
                key: 'APP_MODE',
                value: appMode
            },
            {
                key: 'ALLOW_REGISTRATION',
                value: appMode === 'multi' ? 'true' : 'false'
            },
            {
                key: 'DEFAULT_CONTEXT_TOKEN_LIMIT',
                value: defaultContextTokenLimit.toString()
            },
            {
                key: 'SYSTEM_VERSION',
                value: '1.0.0'
            },
            {
                key: 'INITIALIZED',
                value: 'true'
            }
        ];

        for (const setting of defaultSettings) {
            const existingSetting = await prisma.systemSetting.findUnique({
                where: { key: setting.key }
            });

            if (!existingSetting) {
                await prisma.systemSetting.create({
                    data: setting
                });
                console.log(`✅ 创建系统设置: ${setting.key} = ${setting.value}`);
            } else {
                console.log(`ℹ️  系统设置已存在: ${setting.key}`);
            }
        }

        // 创建示例系统连接（可选）
        const existingConn = await prisma.connection.findFirst({
            where: { ownerUserId: null }
        });

        if (!existingConn) {
            // 创建一个示例系统连接
            await prisma.connection.create({
                data: {
                    provider: 'openai',
                    baseUrl: 'https://api.openai.com/v1',
                    enable: true,
                    authType: 'none',
                    connectionType: 'external',
                }
            });
            console.log('✅ 创建示例系统连接');
        }

        console.log('✅ 初始数据创建完成！');

    } catch (error) {
        console.error('❌ 创建初始数据失败:', error);
        throw error;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
EOF

# 运行初始数据脚本
log_info "运行初始数据脚本..."
if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
    pnpm exec node temp_init_data.js
else
    node temp_init_data.js
fi

# 清理临时脚本
rm -f temp_init_data.js

log_success "数据库初始化完成！"

# 显示数据库信息
echo
log_success "🎉 数据库初始化成功！"
echo
echo "数据库信息:"
echo "  📍 数据库文件: $DATABASE_URL"
echo "  👤 管理员用户: ${DEFAULT_ADMIN_USERNAME:-admin}"
echo "  🔑 管理员密码: ${DEFAULT_ADMIN_PASSWORD:-admin123456}"
echo "  🏗️  应用模式: ${APP_MODE:-single}"
echo "  📊 Token限制: ${DEFAULT_CONTEXT_TOKEN_LIMIT:-4000}"
echo
echo "下一步:"
echo "  1. 启动应用: ./start.sh"
echo "  2. 访问前端: http://localhost:3000"
echo "  3. 使用管理员账户登录"
echo "  4. 在系统设置中配置AI模型API"
echo
