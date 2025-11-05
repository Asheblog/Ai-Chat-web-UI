#!/bin/bash

# =======================================================
# 部署验证脚本
# 验证Docker部署配置是否正确
# =======================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 计数器
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓ PASS]${NC} $1"
    ((PASSED_CHECKS++))
}

log_warning() {
    echo -e "${YELLOW}[⚠ WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗ FAIL]${NC} $1"
    ((FAILED_CHECKS++))
}

log_check() {
    echo -e "${BLUE}[CHECK]${NC} $1"
    ((TOTAL_CHECKS++))
}

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 检查文件存在性
check_file_exists() {
    local file="$1"
    local description="$2"

    log_check "检查文件: $description"

    if [ -f "$file" ]; then
        log_success "文件存在: $file"
        return 0
    else
        log_error "文件缺失: $file"
        return 1
    fi
}

# 检查目录结构
check_directory_structure() {
    log_info "检查项目目录结构..."

    check_file_exists "docker-compose.yml" "Docker Compose配置"
    check_file_exists "docker-compose.dev.yml" "开发环境配置"
    check_file_exists "packages/backend/Dockerfile" "后端Dockerfile"
    check_file_exists "packages/frontend/Dockerfile" "前端Dockerfile"
    check_file_exists "packages/backend/package.json" "后端package.json"
    check_file_exists "packages/frontend/package.json" "前端package.json"
    check_file_exists ".env.example" "环境变量模板"
}

# 检查Docker配置
check_docker_config() {
    log_info "检查Docker配置..."

    log_check "检查Docker是否安装"
    if command -v docker &> /dev/null; then
        local docker_version=$(docker --version)
        log_success "Docker已安装: $docker_version"
    else
        log_error "Docker未安装"
        return 1
    fi

    log_check "检查Docker Compose是否可用"
    if command -v docker-compose &> /dev/null; then
        local compose_version=$(docker-compose --version)
        log_success "Docker Compose已安装: $compose_version"
    elif docker compose version &> /dev/null; then
        local compose_version=$(docker compose version)
        log_success "Docker Compose (插件)已安装: $compose_version"
    else
        log_error "Docker Compose未安装"
        return 1
    fi
}

# 检查Docker Compose配置语法
check_compose_syntax() {
    log_info "检查Docker Compose配置语法..."

    log_check "验证生产环境配置"
    if docker-compose -f docker-compose.yml config > /dev/null 2>&1; then
        log_success "生产环境配置语法正确"
    else
        log_error "生产环境配置语法错误"
        docker-compose -f docker-compose.yml config
        return 1
    fi

    log_check "验证开发环境配置"
    if docker-compose -f docker-compose.dev.yml config > /dev/null 2>&1; then
        log_success "开发环境配置语法正确"
    else
        log_error "开发环境配置语法错误"
        docker-compose -f docker-compose.dev.yml config
        return 1
    fi
}

# 检查端口冲突
check_port_conflicts() {
    log_info "检查端口占用情况..."

    local ports=(3000 8001 5555)
    local port_names=("前端" "后端" "Prisma Studio")

    for i in "${!ports[@]}"; do
        local port=${ports[$i]}
        local name=${port_names[$i]}

        log_check "检查端口 $port ($name)"

        if command -v netstat &> /dev/null; then
            if netstat -tuln 2>/dev/null | grep ":$port " > /dev/null; then
                log_warning "端口 $port 已被占用 ($name)"
            else
                log_success "端口 $port 可用 ($name)"
            fi
        elif command -v ss &> /dev/null; then
            if ss -tuln 2>/dev/null | grep ":$port " > /dev/null; then
                log_warning "端口 $port 已被占用 ($name)"
            else
                log_success "端口 $port 可用 ($name)"
            fi
        else
            log_warning "无法检查端口占用 (缺少netstat或ss命令)"
        fi
    done
}

# 检查环境配置
check_environment_config() {
    log_info "检查环境配置..."

    log_check "检查环境变量模板"
    if [ -f ".env.example" ]; then
        local required_vars=("NODE_ENV" "DATABASE_URL" "JWT_SECRET")
        local missing_vars=()

        for var in "${required_vars[@]}"; do
            if grep -q "^$var=" .env.example; then
                log_success "环境变量定义存在: $var"
            else
                log_warning "环境变量定义缺失: $var"
                missing_vars+=("$var")
            fi
        done

        if [ ${#missing_vars[@]} -eq 0 ]; then
            log_success "所有必需的环境变量都已定义"
        else
            log_warning "部分环境变量缺失: ${missing_vars[*]}"
        fi
    fi

    log_check "检查脚本权限"
    if [ -x "start.sh" ]; then
        log_success "启动脚本可执行"
    else
        log_warning "启动脚本不可执行，请运行: chmod +x start.sh"
    fi
}

# 检查构建配置
check_build_config() {
    log_info "检查构建配置..."

    log_check "检查后端构建配置"
    if [ -f "packages/backend/Dockerfile" ]; then
        if grep -q "target.*production" packages/backend/Dockerfile; then
            log_success "后端支持多阶段构建"
        else
            log_warning "后端未配置多阶段构建"
        fi

        if grep -q "node:.*alpine" packages/backend/Dockerfile; then
            log_success "后端使用Alpine镜像 (优化大小)"
        else
            log_warning "后端未使用Alpine镜像"
        fi
    fi

    log_check "检查前端构建配置"
    if [ -f "packages/frontend/Dockerfile" ]; then
        if grep -q "target.*production" packages/frontend/Dockerfile; then
            log_success "前端支持多阶段构建"
        else
            log_warning "前端未配置多阶段构建"
        fi

        if grep -q "standalone" packages/frontend/next.config.js; then
            log_success "前端配置了standalone构建"
        else
            log_warning "前端未配置standalone构建"
        fi
    fi
}

# 检查资源配置
check_resource_limits() {
    log_info "检查资源配置..."

    log_check "检查后端资源限制"
    if grep -A 10 "backend:" docker-compose.yml | grep -q "memory:"; then
        local memory_limit=$(grep -A 10 "backend:" docker-compose.yml | grep "memory:" | awk '{print $2}')
        log_success "后端内存限制: $memory_limit"

        # 检查是否符合要求 (< 512MB)
        local memory_mb=${memory_limit%M}
        if [ "$memory_mb" -le 512 ]; then
            log_success "后端内存限制符合要求 (≤512MB)"
        else
            log_warning "后端内存限制过高: ${memory_mb}MB (>512MB)"
        fi
    else
        log_warning "后端未设置内存限制"
    fi

    log_check "检查健康检查配置"
    if grep -q "healthcheck:" docker-compose.yml; then
        log_success "配置了健康检查"
    else
        log_warning "未配置健康检查"
    fi
}

# 检查网络配置
check_network_config() {
    log_info "检查网络配置..."

    log_check "检查网络定义"
    if grep -q "networks:" docker-compose.yml; then
        log_success "定义了自定义网络"

        if grep -q "name: aichat_network" docker-compose.yml; then
            log_success "网络命名规范正确"
        fi
    else
        log_warning "未定义自定义网络"
    fi

    log_check "检查服务间通信"
    if grep -q "depends_on:" docker-compose.yml; then
        log_success "配置了服务依赖"
    else
        log_warning "未配置服务依赖"
    fi
}

# 检查数据持久化
check_data_persistence() {
    log_info "检查数据持久化配置..."

    log_check "检查数据卷配置"
    if grep -q "volumes:" docker-compose.yml; then
        log_success "配置了数据持久化"

        if grep -q "backend_data:" docker-compose.yml; then
            log_success "配置了数据库数据卷"
        fi

        if grep -q "name:" docker-compose.yml; then
            log_success "数据卷命名规范正确"
        fi
    else
        log_warning "未配置数据持久化"
    fi
}

# 检查脚本完整性
check_scripts() {
    log_info "检查管理脚本..."

    local scripts=(
        "start.sh:启动脚本"
        "scripts/init-db.sh:数据库初始化脚本"
        "scripts/db-manager.sh:数据库管理脚本"
        "scripts/verify-deployment.sh:部署验证脚本"
    )

    for script_info in "${scripts[@]}"; do
        local script="${script_info%:*}"
        local description="${script_info#*:}"

        log_check "检查脚本: $description"
        if [ -f "$script" ]; then
            if [ -x "$script" ]; then
                log_success "脚本存在且可执行: $script"
            else
                log_warning "脚本存在但不可执行: $script"
            fi
        else
            log_error "脚本缺失: $script"
        fi
    done
}

# 模拟构建测试 (dry-run)
simulate_build() {
    log_info "模拟构建测试..."

    log_check "检查后端构建上下文"
    if [ -f "packages/backend/package.json" ] && [ -f "packages/backend/Dockerfile" ]; then
        log_success "后端构建上下文完整"
    else
        log_error "后端构建上下文不完整"
        return 1
    fi

    log_check "检查前端构建上下文"
    if [ -f "packages/frontend/package.json" ] && [ -f "packages/frontend/Dockerfile" ]; then
        log_success "前端构建上下文完整"
    else
        log_error "前端构建上下文不完整"
        return 1
    fi
}

# 生成报告
generate_report() {
    echo
    echo "=================================================="
    echo "🔍 部署配置验证报告"
    echo "=================================================="
    echo "📊 总检查项: $TOTAL_CHECKS"
    echo "✅ 通过检查: $PASSED_CHECKS"
    echo "❌ 失败检查: $FAILED_CHECKS"
    echo "⚠️  警告项:   $(($TOTAL_CHECKS - $PASSED_CHECKS - $FAILED_CHECKS))"
    echo

    if [ $FAILED_CHECKS -eq 0 ]; then
        echo "🎉 配置验证通过！可以进行部署。"
        echo
        echo "📋 下一步操作:"
        echo "  1. 复制环境配置: cp .env.example .env"
        echo "  2. 编辑环境变量: vim .env"
        echo "  3. 启动应用: ./start.sh prod"
        echo
    else
        echo "⚠️  发现 $FAILED_CHECKS 个配置问题，请修复后重新检查。"
        echo
        exit 1
    fi
}

# 主函数
main() {
    echo "🚀 开始验证AI聊天平台部署配置..."
    echo

    check_directory_structure
    check_docker_config
    check_compose_syntax
    check_port_conflicts
    check_environment_config
    check_build_config
    check_resource_limits
    check_network_config
    check_data_persistence
    check_scripts
    simulate_build

    generate_report
}

# 执行主函数
main "$@"
