#!/bin/bash

# =======================================================
# 数据库管理脚本
# 提供数据库备份、恢复、重置等功能
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

# 进入后端目录
cd "$BACKEND_DIR"

# 设置默认数据库文件
DB_FILE="${DATABASE_URL#file:}"
if [ -z "$DB_FILE" ]; then
    DB_FILE="./data/app.db"
fi

BACKUP_DIR="$PROJECT_ROOT/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# 显示帮助信息
show_help() {
    cat << EOF
数据库管理脚本

用法:
    $0 [命令] [选项]

命令:
    backup          备份数据库
    restore <file>  恢复数据库
    reset           重置数据库（删除所有数据）
    migrate         运行数据库迁移
    studio          启动Prisma Studio
    seed            重新种子数据
    info            显示数据库信息

选项:
    -h, --help      显示帮助信息

示例:
    $0 backup                     # 备份数据库
    $0 restore backup_20231201.db # 恢复数据库
    $0 reset                      # 重置数据库
    $0 studio                     # 启动数据库管理界面

EOF
}

# 检查数据库文件是否存在
check_db_exists() {
    if [ ! -f "$DB_FILE" ]; then
        log_error "数据库文件不存在: $DB_FILE"
        log_info "请先运行数据库初始化: ./scripts/init-db.sh"
        exit 1
    fi
}

# 创建备份目录
create_backup_dir() {
    mkdir -p "$BACKUP_DIR"
}

# 备份数据库
backup_database() {
    log_info "备份数据库..."
    check_db_exists
    create_backup_dir

    local backup_file="$BACKUP_DIR/backup_$TIMESTAMP.db"

    cp "$DB_FILE" "$backup_file"

    # 压缩备份文件
    gzip "$backup_file"
    backup_file="${backup_file}.gz"

    log_success "数据库备份完成: $backup_file"

    # 显示备份文件信息
    local file_size=$(du -h "$backup_file" | cut -f1)
    echo "  📁 备份文件: $backup_file"
    echo "  📊 文件大小: $file_size"
}

# 恢复数据库
restore_database() {
    local backup_file="$1"

    if [ -z "$backup_file" ]; then
        log_error "请指定备份文件"
        echo "用法: $0 restore <backup_file>"
        exit 1
    fi

    if [ ! -f "$backup_file" ]; then
        log_error "备份文件不存在: $backup_file"
        exit 1
    fi

    log_warning "即将恢复数据库，当前数据将被覆盖！"
    read -p "确认继续？(y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "操作已取消"
        exit 0
    fi

    log_info "恢复数据库..."

    # 创建当前数据库的备份
    if [ -f "$DB_FILE" ]; then
        local current_backup="$BACKUP_DIR/before_restore_$TIMESTAMP.db"
        cp "$DB_FILE" "$current_backup"
        log_info "当前数据库已备份到: $current_backup"
    fi

    # 确保数据目录存在
    mkdir -p "$(dirname "$DB_FILE")"

    # 恢复数据库
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" > "$DB_FILE"
    else
        cp "$backup_file" "$DB_FILE"
    fi

    log_success "数据库恢复完成"
}

# 重置数据库
reset_database() {
    log_warning "即将重置数据库，所有数据将被删除！"
    read -p "确认继续？(y/N): " -n 1 -r
    echo

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "操作已取消"
        exit 0
    fi

    log_info "重置数据库..."

    # 备份当前数据库
    if [ -f "$DB_FILE" ]; then
        create_backup_dir
        local backup_file="$BACKUP_DIR/before_reset_$TIMESTAMP.db"
        cp "$DB_FILE" "$backup_file"
        log_info "当前数据库已备份到: $backup_file"
    fi

    # 删除数据库文件
    rm -f "$DB_FILE"

    # 重新初始化数据库
    log_info "重新初始化数据库..."
    if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
        pnpm db:push
    else
        npm run db:push
    fi

    # 重新创建种子数据
    log_info "创建种子数据..."
    "$SCRIPT_DIR/init-db.sh"

    log_success "数据库重置完成"
}

# 运行迁移
run_migrations() {
    log_info "运行数据库迁移..."

    if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
        pnpm db:migrate deploy
    else
        npx prisma migrate deploy
    fi

    log_success "数据库迁移完成"
}

# 启动Prisma Studio
start_studio() {
    log_info "启动Prisma Studio..."

    if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
        pnpm db:studio
    else
        npm run db:studio
    fi
}

# 重新种子数据
seed_data() {
    log_info "重新种子数据..."

    # 运行初始化脚本
    "$SCRIPT_DIR/init-db.sh"

    log_success "种子数据创建完成"
}

# 显示数据库信息
show_info() {
    echo "=== 数据库信息 ==="
    echo "📍 数据库文件: $DB_FILE"

    if [ -f "$DB_FILE" ]; then
        local file_size=$(du -h "$DB_FILE" | cut -f1)
        local file_time=$(stat -c %y "$DB_FILE" 2>/dev/null || stat -f %Sm "$DB_FILE" 2>/dev/null)
        echo "📊 文件大小: $file_size"
        echo "📅 修改时间: $file_time"

        # 使用Prisma查询数据库统计信息
        log_info "查询数据库统计信息..."
        if command -v pnpm &> /dev/null && [ -f "pnpm-lock.yaml" ]; then
            echo ""
            pnpm exec node -e "
                const { PrismaClient } = require('@prisma/client');
                const prisma = new PrismaClient();

                async function getStats() {
                    try {
                        const userCount = await prisma.user.count();
                        const sessionCount = await prisma.chatSession.count();
                        const messageCount = await prisma.message.count();
                        const modelCount = await prisma.modelConfig.count();

                        console.log('👥 用户数量: ' + userCount);
                        console.log('💬 会话数量: ' + sessionCount);
                        console.log('📨 消息数量: ' + messageCount);
                        console.log('🤖 模型配置: ' + modelCount);
                    } catch (error) {
                        console.log('❌ 无法获取统计信息: ' + error.message);
                    } finally {
                        await prisma.\$disconnect();
                    }
                }

                getStats();
            "
        fi
    else
        echo "❌ 数据库文件不存在"
    fi

    echo ""
    echo "📁 备份目录: $BACKUP_DIR"
    if [ -d "$BACKUP_DIR" ]; then
        local backup_count=$(ls -1 "$BACKUP_DIR"/*.db* 2>/dev/null | wc -l)
        echo "📦 备份文件: $backup_count 个"
    fi
}

# 主函数
main() {
    case "$1" in
        backup)
            backup_database
            ;;
        restore)
            restore_database "$2"
            ;;
        reset)
            reset_database
            ;;
        migrate)
            run_migrations
            ;;
        studio)
            start_studio
            ;;
        seed)
            seed_data
            ;;
        info)
            show_info
            ;;
        -h|--help|"")
            show_help
            ;;
        *)
            log_error "未知命令: $1"
            echo
            show_help
            exit 1
            ;;
    esac
}

# 执行主函数
main "$@"