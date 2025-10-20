#!/bin/bash

# =======================================================
# AI聊天平台一键启动脚本
# 支持开发和生产环境
# =======================================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# 显示帮助信息
show_help() {
    cat << EOF
AI聊天平台启动脚本

用法:
    $0 [选项] [环境]

环境:
    dev     开发环境 (默认)
    prod    生产环境

选项:
    -h, --help      显示帮助信息
    -b, --build     强制重新构建镜像
    -d, --down      停止并删除容器
    -l, --logs      显示日志
    -r, --restart   重启服务
    -s, --status    显示服务状态
    -c, --clean     清理未使用的镜像和容器

示例:
    $0 dev          # 启动开发环境
    $0 prod --build # 构建并启动生产环境
    $0 --down       # 停止所有服务
    $0 --logs       # 查看日志

EOF
}

# 检查Docker和Docker Compose
check_dependencies() {
    log_info "检查依赖..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker未安装，请先安装Docker"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        log_error "Docker Compose未安装，请先安装Docker Compose"
        exit 1
    fi

    log_success "依赖检查通过"
}

# 检查环境变量文件
check_env_file() {
    local env_file=".env"

    if [ "$ENV" = "prod" ] && [ ! -f "$env_file" ]; then
        log_warning "生产环境需要.env文件，正在创建默认配置..."
        cp .env.example "$env_file"
        log_warning "请编辑.env文件配置生产环境参数，特别是JWT_SECRET和管理员密码"
    fi

    if [ -f "$env_file" ]; then
        log_success "找到环境变量文件: $env_file"
    else
        log_info "未找到.env文件，使用默认配置"
    fi
}

# 选择Docker Compose文件
select_compose_file() {
    if [ "$ENV" = "dev" ]; then
        COMPOSE_FILE="docker-compose.dev.yml"
        PROJECT_NAME="aichat-dev"
    else
        COMPOSE_FILE="docker-compose.yml"
        PROJECT_NAME="aichat"
    fi

    if [ ! -f "$COMPOSE_FILE" ]; then
        log_error "找不到Docker Compose文件: $COMPOSE_FILE"
        exit 1
    fi

    log_info "使用Docker Compose文件: $COMPOSE_FILE"
}

# 构建镜像
build_images() {
    log_info "构建Docker镜像..."

    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" build
    else
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" build
    fi

    log_success "镜像构建完成"
}

# 启动服务
start_services() {
    log_info "启动服务 (环境: $ENV)..."

    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d
    else
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" up -d
    fi

    log_success "服务启动完成"

    # 显示服务信息
    show_service_info
}

# 停止服务
stop_services() {
    log_info "停止服务..."

    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down
    else
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" down
    fi

    log_success "服务已停止"
}

# 显示日志
show_logs() {
    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs -f
    else
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" logs -f
    fi
}

# 显示服务状态
show_status() {
    log_info "服务状态:"

    if command -v docker-compose &> /dev/null; then
        docker-compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" ps
    else
        docker compose -f "$COMPOSE_FILE" -p "$PROJECT_NAME" ps
    fi
}

# 显示服务信息
show_service_info() {
    echo
    log_success "🎉 AI聊天平台启动成功！"
    echo
    echo "服务访问地址:"

    if [ "$ENV" = "dev" ]; then
        echo "  🌐 前端应用:     http://localhost:3000"
        echo "  🔧 后端API:      http://localhost:8001"
        echo "  🗄️  数据库管理:   http://localhost:5555 (Prisma Studio)"
        echo
        echo "开发环境特性:"
        echo "  ✅ 热重载支持"
        echo "  ✅ 调试模式开启"
        echo "  ✅ 详细日志输出"
    else
        echo "  🌐 前端应用:     http://localhost:3000"
        echo "  🔧 后端API:      http://localhost:8001"
        echo
        echo "生产环境特性:"
        echo "  ✅ 内存优化 (< 512MB)"
        echo "  ✅ 健康检查"
        echo "  ✅ 自动重启"
    fi

    echo
    echo "默认管理员账户:"
    echo "  👤 用户名: admin"
    echo "  🔑 密码:   admin123456"
    echo
    echo "管理命令:"
    echo "  📋 查看日志:   $0 --logs"
    echo "  🛑 停止服务:   $0 --down"
    echo "  🔄 重启服务:   $0 --restart"
    echo "  📊 查看状态:   $0 --status"
    echo
}

# 重启服务
restart_services() {
    log_info "重启服务..."
    stop_services
    sleep 2
    start_services
}

# 清理资源
clean_resources() {
    log_info "清理未使用的Docker资源..."

    # 清理停止的容器
    docker container prune -f

    # 清理未使用的镜像
    docker image prune -f

    # 清理未使用的卷（谨慎操作）
    # docker volume prune -f

    log_success "资源清理完成"
}

# 主函数
main() {
    # 默认参数
    ENV="dev"
    BUILD=false
    DOWN=false
    LOGS=false
    RESTART=false
    STATUS=false
    CLEAN=false

    # 解析命令行参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            dev|prod)
                ENV="$1"
                shift
                ;;
            -b|--build)
                BUILD=true
                shift
                ;;
            -d|--down)
                DOWN=true
                shift
                ;;
            -l|--logs)
                LOGS=true
                shift
                ;;
            -r|--restart)
                RESTART=true
                shift
                ;;
            -s|--status)
                STATUS=true
                shift
                ;;
            -c|--clean)
                CLEAN=true
                shift
                ;;
            *)
                log_error "未知参数: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # 检查依赖
    check_dependencies

    # 选择配置文件
    select_compose_file

    # 检查环境变量
    check_env_file

    # 执行相应操作
    if [ "$DOWN" = true ]; then
        stop_services
    elif [ "$LOGS" = true ]; then
        show_logs
    elif [ "$STATUS" = true ]; then
        show_status
    elif [ "$RESTART" = true ]; then
        restart_services
    elif [ "$CLEAN" = true ]; then
        clean_resources
    else
        # 正常启动流程
        if [ "$BUILD" = true ]; then
            build_images
        fi
        start_services
    fi
}

# 执行主函数
main "$@"