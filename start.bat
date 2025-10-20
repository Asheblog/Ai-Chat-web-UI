@echo off
setlocal enabledelayedexpansion

:: =======================================================
:: AI聊天平台一键启动脚本 (Windows版本)
:: 支持开发和生产环境
:: =======================================================

:: 设置代码页为UTF-8
chcp 65001 >nul

:: 颜色定义
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

:: 默认参数
set "ENV=dev"
set "BUILD=false"
set "DOWN=false"
set "LOGS=false"
set "RESTART=false"
set "STATUS=false"
set "CLEAN=false"

:: 选择 docker compose 命令
set "COMPOSE_CMD=docker-compose"
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    docker compose version >nul 2>&1
    if %errorlevel% eq 0 (
        set "COMPOSE_CMD=docker compose"
    )
)

:: 日志函数
:log_info
echo %BLUE%[INFO]%NC% %~1
goto :eof

:log_success
echo %GREEN%[SUCCESS]%NC% %~1
goto :eof

:log_warning
echo %YELLOW%[WARNING]%NC% %~1
goto :eof

:log_error
echo %RED%[ERROR]%NC% %~1
goto :eof

:: 显示帮助信息
:show_help
echo AI聊天平台启动脚本 (Windows版本)
echo.
echo 用法:
echo     %~nx0 [选项] [环境]
echo.
echo 环境:
echo     dev     开发环境 (默认)
echo     prod    生产环境
echo.
echo 选项:
echo     -h, --help      显示帮助信息
echo     -b, --build     强制重新构建镜像
echo     -d, --down      停止并删除容器
echo     -l, --logs      显示日志
echo     -r, --restart   重启服务
echo     -s, --status    显示服务状态
echo     -c, --clean     清理未使用的镜像和容器
echo.
echo 示例:
echo     %~nx0 dev          # 启动开发环境
echo     %~nx0 prod --build # 构建并启动生产环境
echo     %~nx0 --down       # 停止所有服务
echo     %~nx0 --logs       # 查看日志
echo.
goto :eof

:: 检查Docker和Docker Compose
:check_dependencies
call :log_info "检查依赖..."

docker --version >nul 2>&1
if %errorlevel% neq 0 (
    call :log_error "Docker未安装，请先安装Docker Desktop"
    exit /b 1
)

docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    docker compose version >nul 2>&1
    if %errorlevel% neq 0 (
        call :log_error "Docker Compose未安装，请先安装Docker Compose"
        exit /b 1
    )
)

call :log_success "依赖检查通过"
goto :eof

:: 检查环境变量文件
:check_env_file
set "env_file=.env"

if "%ENV%"=="prod" (
    if not exist "%env_file%" (
        call :log_warning "生产环境需要.env文件，正在创建默认配置..."
        copy ".env.example" "%env_file%" >nul
        call :log_warning "请编辑.env文件配置生产环境参数，特别是JWT_SECRET和管理员密码"
    )
)

if exist "%env_file%" (
    call :log_success "找到环境变量文件: %env_file%"
) else (
    call :log_info "未找到.env文件，使用默认配置"
)
goto :eof

:: 选择Docker Compose文件
:select_compose_file
if "%ENV%"=="dev" (
    set "COMPOSE_FILE=docker-compose.dev.yml"
    set "PROJECT_NAME=aichat-dev"
) else (
    set "COMPOSE_FILE=docker-compose.yml"
    set "PROJECT_NAME=aichat"
)

if not exist "%COMPOSE_FILE%" (
    call :log_error "找不到Docker Compose文件: %COMPOSE_FILE%"
    exit /b 1
)

call :log_info "使用Docker Compose文件: %COMPOSE_FILE%"
goto :eof

:: 构建镜像
:build_images
call :log_info "构建Docker镜像..."

%COMPOSE_CMD% -f "%COMPOSE_FILE%" -p "%PROJECT_NAME%" build
if %errorlevel% neq 0 (
    call :log_error "镜像构建失败"
    exit /b 1
)

call :log_success "镜像构建完成"
goto :eof

:: 启动服务
:start_services
call :log_info "启动服务 (环境: %ENV%)..."

%COMPOSE_CMD% -f "%COMPOSE_FILE%" -p "%PROJECT_NAME%" up -d
if %errorlevel% neq 0 (
    call :log_error "服务启动失败"
    exit /b 1
)

call :log_success "服务启动完成"
call :show_service_info
goto :eof

:: 停止服务
:stop_services
call :log_info "停止服务..."

%COMPOSE_CMD% -f "%COMPOSE_FILE%" -p "%PROJECT_NAME%" down
call :log_success "服务已停止"
goto :eof

:: 显示日志
:show_logs
%COMPOSE_CMD% -f "%COMPOSE_FILE%" -p "%PROJECT_NAME%" logs -f
goto :eof

:: 显示服务状态
:show_status
call :log_info "服务状态:"
%COMPOSE_CMD% -f "%COMPOSE_FILE%" -p "%PROJECT_NAME%" ps
goto :eof

:: 显示服务信息
:show_service_info
echo.
call :log_success "🎉 AI聊天平台启动成功！"
echo.
echo 服务访问地址:

if "%ENV%"=="dev" (
    echo   🌐 前端应用:     http://localhost:3000
    echo   🔧 后端API:      http://localhost:8001
    echo   🗄️  数据库管理:   http://localhost:5555 (Prisma Studio)
    echo.
    echo 开发环境特性:
    echo   ✅ 热重载支持
    echo   ✅ 调试模式开启
    echo   ✅ 详细日志输出
) else (
    echo   🌐 前端应用:     http://localhost:3000
    echo   🔧 后端API:      http://localhost:8001
    echo.
    echo 生产环境特性:
    echo   ✅ 内存优化 (^< 512MB)
    echo   ✅ 健康检查
    echo   ✅ 自动重启
)

echo.
echo 默认管理员账户:
echo   👤 用户名: admin
echo   🔑 密码:   admin123456
echo.
echo 管理命令:
echo   📋 查看日志:   %~nx0 --logs
echo   🛑 停止服务:   %~nx0 --down
echo   🔄 重启服务:   %~nx0 --restart
echo   📊 查看状态:   %~nx0 --status
echo.
goto :eof

:: 重启服务
:restart_services
call :log_info "重启服务..."
call :stop_services
timeout /t 2 /nobreak >nul
call :start_services
goto :eof

:: 清理资源
:clean_resources
call :log_info "清理未使用的Docker资源..."

docker container prune -f
docker image prune -f

call :log_success "资源清理完成"
goto :eof

:: 解析命令行参数
:parse_args
if "%~1"=="" goto :main_start
if "%~1"=="-h" goto :show_help_and_exit
if "%~1"=="--help" goto :show_help_and_exit
if "%~1"=="dev" (
    set "ENV=dev"
    shift
    goto :parse_args
)
if "%~1"=="prod" (
    set "ENV=prod"
    shift
    goto :parse_args
)
if "%~1"=="-b" (
    set "BUILD=true"
    shift
    goto :parse_args
)
if "%~1"=="--build" (
    set "BUILD=true"
    shift
    goto :parse_args
)
if "%~1"=="-d" (
    set "DOWN=true"
    shift
    goto :parse_args
)
if "%~1"=="--down" (
    set "DOWN=true"
    shift
    goto :parse_args
)
if "%~1"=="-l" (
    set "LOGS=true"
    shift
    goto :parse_args
)
if "%~1"=="--logs" (
    set "LOGS=true"
    shift
    goto :parse_args
)
if "%~1"=="-r" (
    set "RESTART=true"
    shift
    goto :parse_args
)
if "%~1"=="--restart" (
    set "RESTART=true"
    shift
    goto :parse_args
)
if "%~1"=="-s" (
    set "STATUS=true"
    shift
    goto :parse_args
)
if "%~1"=="--status" (
    set "STATUS=true"
    shift
    goto :parse_args
)
if "%~1"=="-c" (
    set "CLEAN=true"
    shift
    goto :parse_args
)
if "%~1"=="--clean" (
    set "CLEAN=true"
    shift
    goto :parse_args
)

call :log_error "未知参数: %~1"
call :show_help
exit /b 1

:show_help_and_exit
call :show_help
exit /b 0

:: 主函数开始
:main_start
call :parse_args %*

call :check_dependencies
if %errorlevel% neq 0 exit /b 1

call :select_compose_file
call :check_env_file

if "%DOWN%"=="true" (
    call :stop_services
) else if "%LOGS%"=="true" (
    call :show_logs
) else if "%STATUS%"=="true" (
    call :show_status
) else if "%RESTART%"=="true" (
    call :restart_services
) else if "%CLEAN%"=="true" (
    call :clean_resources
) else (
    if "%BUILD%"=="true" (
        call :build_images
        if %errorlevel% neq 0 exit /b 1
    )
    call :start_services
    if %errorlevel% neq 0 exit /b 1
)

pause
