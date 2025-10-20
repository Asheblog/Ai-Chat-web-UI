@echo off
setlocal enabledelayedexpansion

:: =======================================================
:: 数据库初始化脚本 (Windows版本)
:: 用于创建数据库表结构和初始数据
:: =======================================================

:: 设置代码页为UTF-8
chcp 65001 >nul

:: 颜色定义
set "RED=[91m"
set "GREEN=[92m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

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

:: 获取脚本目录
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "BACKEND_DIR=%PROJECT_ROOT%\packages\backend"

:: 检查后端目录
if not exist "%BACKEND_DIR%" (
    call :log_error "找不到后端目录: %BACKEND_DIR%"
    exit /b 1
)

:: 进入后端目录
cd /d "%BACKEND_DIR%"

:: 检查Prisma schema文件
if not exist "prisma\schema.prisma" (
    call :log_error "找不到Prisma schema文件: prisma\schema.prisma"
    exit /b 1
)

call :log_info "开始初始化数据库..."

:: 检查环境变量
if "%DATABASE_URL%"=="" (
    set "DATABASE_URL=file:./data/dev.db"
    call :log_warning "未设置DATABASE_URL，使用默认值: %DATABASE_URL%"
)

:: 创建数据目录
for %%i in ("%DATABASE_URL%") do set "DB_PATH=%%~fi"
for %%d in ("%DB_PATH%") do set "DB_DIR=%%~dpd"
if not exist "%DB_DIR%" mkdir "%DB_DIR%"

:: 生成Prisma客户端
call :log_info "生成Prisma客户端..."
if exist "pnpm-lock.yaml" (
    pnpm db:generate
) else (
    npm run db:generate
)

if %errorlevel% neq 0 (
    call :log_error "Prisma客户端生成失败"
    exit /b 1
)

:: 推送数据库schema
call :log_info "创建数据库表结构..."
if exist "pnpm-lock.yaml" (
    pnpm db:push
) else (
    npm run db:push
)

if %errorlevel% neq 0 (
    call :log_error "数据库表结构创建失败"
    exit /b 1
)

:: 运行数据库迁移（如果有迁移文件）
if exist "prisma\migrations\*" (
    call :log_info "运行数据库迁移..."
    if exist "pnpm-lock.yaml" (
        pnpm db:migrate deploy
    ) else (
        npx prisma migrate deploy
    )
)

:: 创建初始数据
call :log_info "创建初始数据..."

:: 创建初始数据脚本文件
echo const { PrismaClient } = require('@prisma/client'); > temp_init_data.js
echo const bcrypt = require('bcryptjs'); >> temp_init_data.js
echo. >> temp_init_data.js
echo const prisma = new PrismaClient(); >> temp_init_data.js
echo. >> temp_init_data.js
echo async function main() { >> temp_init_data.js
echo     console.log('开始创建初始数据...'); >> temp_init_data.js
echo. >> temp_init_data.js
echo     // 获取环境变量 >> temp_init_data.js
echo     const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME ^|^| 'admin'; >> temp_init_data.js
echo     const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD ^|^| 'admin123456'; >> temp_init_data.js
echo     const appMode = process.env.APP_MODE ^|^| 'single'; >> temp_init_data.js
echo     const defaultContextTokenLimit = parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT ^|^| '4000'); >> temp_init_data.js
echo. >> temp_init_data.js
echo     try { >> temp_init_data.js
echo         // 检查是否已有管理员用户 >> temp_init_data.js
echo         const existingAdmin = await prisma.user.findFirst({ >> temp_init_data.js
echo             where: { role: 'ADMIN' } >> temp_init_data.js
echo         }); >> temp_init_data.js
echo. >> temp_init_data.js
echo         if ^(!existingAdmin^) { >> temp_init_data.js
echo             // 创建默认管理员用户 >> temp_init_data.js
echo             const hashedPassword = await bcrypt.hash(defaultAdminPassword, 10); >> temp_init_data.js
echo. >> temp_init_data.js
echo             const admin = await prisma.user.create({ >> temp_init_data.js
echo                 data: { >> temp_init_data.js
echo                     username: defaultAdminUsername, >> temp_init_data.js
echo                     hashedPassword: hashedPassword, >> temp_init_data.js
echo                     role: 'ADMIN' >> temp_init_data.js
echo                 } >> temp_init_data.js
echo             }); >> temp_init_data.js
echo. >> temp_init_data.js
echo             console.log(`✅ 创建管理员用户: ${admin.username}`^); >> temp_init_data.js
echo         } else { >> temp_init_data.js
echo             console.log(`ℹ️  管理员用户已存在: ${existingAdmin.username}`^); >> temp_init_data.js
echo         } >> temp_init_data.js
echo. >> temp_init_data.js
echo         // 创建系统设置 >> temp_init_data.js
echo         const defaultSettings = [ >> temp_init_data.js
echo             { >> temp_init_data.js
echo                 key: 'APP_MODE', >> temp_init_data.js
echo                 value: appMode >> temp_init_data.js
echo             }, >> temp_init_data.js
echo             { >> temp_init_data.js
echo                 key: 'ALLOW_REGISTRATION', >> temp_init_data.js
echo                 value: appMode === 'multi' ? 'true' : 'false' >> temp_init_data.js
echo             }, >> temp_init_data.js
echo             { >> temp_init_data.js
echo                 key: 'DEFAULT_CONTEXT_TOKEN_LIMIT', >> temp_init_data.js
echo                 value: defaultContextTokenLimit.toString^(^) >> temp_init_data.js
echo             }, >> temp_init_data.js
echo             { >> temp_init_data.js
echo                 key: 'SYSTEM_VERSION', >> temp_init_data.js
echo                 value: '1.0.0' >> temp_init_data.js
echo             }, >> temp_init_data.js
echo             { >> temp_init_data.js
echo                 key: 'INITIALIZED', >> temp_init_data.js
echo                 value: 'true' >> temp_init_data.js
echo             } >> temp_init_data.js
echo         ]; >> temp_init_data.js
echo. >> temp_init_data.js
echo         for ^(const setting of defaultSettings^) { >> temp_init_data.js
echo             const existingSetting = await prisma.systemSetting.findUnique({ >> temp_init_data.js
echo                 where: { key: setting.key } >> temp_init_data.js
echo             }); >> temp_init_data.js
echo. >> temp_init_data.js
echo             if ^(!existingSetting^) { >> temp_init_data.js
echo                 await prisma.systemSetting.create({ >> temp_init_data.js
echo                     data: setting >> temp_init_data.js
echo                 }); >> temp_init_data.js
echo                 console.log(`✅ 创建系统设置: ${setting.key} = ${setting.value}`^); >> temp_init_data.js
echo             } else { >> temp_init_data.js
echo                 console.log(`ℹ️  系统设置已存在: ${setting.key}`^); >> temp_init_data.js
echo             } >> temp_init_data.js
echo         } >> temp_init_data.js
echo. >> temp_init_data.js
echo         console.log('✅ 初始数据创建完成！'^); >> temp_init_data.js
echo. >> temp_init_data.js
echo     } catch ^(error^) { >> temp_init_data.js
echo         console.error('❌ 创建初始数据失败:', error^); >> temp_init_data.js
echo         throw error; >> temp_init_data.js
echo     } >> temp_init_data.js
echo } >> temp_init_data.js
echo. >> temp_init_data.js
echo main^(^) >> temp_init_data.js
echo     .catch^(^(e^) ^=> { >> temp_init_data.js
echo         console.error^(e^); >> temp_init_data.js
echo         process.exit^(1^); >> temp_init_data.js
echo     }^) >> temp_init_data.js
echo     .finally^(async ^(^^) ^=> { >> temp_init_data.js
echo         await prisma.$disconnect^(^); >> temp_init_data.js
echo     }^); >> temp_init_data.js

:: 运行初始数据脚本
call :log_info "运行初始数据脚本..."
if exist "pnpm-lock.yaml" (
    pnpm exec node temp_init_data.js
) else (
    node temp_init_data.js
)

if %errorlevel% neq 0 (
    call :log_error "初始数据创建失败"
    del temp_init_data.js >nul 2>&1
    exit /b 1
)

:: 清理临时脚本
del temp_init_data.js >nul 2>&1

call :log_success "数据库初始化完成！"

:: 显示数据库信息
echo.
call :log_success "🎉 数据库初始化成功！"
echo.
echo 数据库信息:
echo   📍 数据库文件: %DATABASE_URL%
echo   👤 管理员用户: %DEFAULT_ADMIN_USERNAME%
echo   🔑 管理员密码: %DEFAULT_ADMIN_PASSWORD%
echo   🏗️  应用模式: %APP_MODE%
echo   📊 Token限制: %DEFAULT_CONTEXT_TOKEN_LIMIT%
echo.
echo 下一步:
echo   1. 启动应用: start.bat
echo   2. 访问前端: http://localhost:3000
echo   3. 使用管理员账户登录
echo   4. 在系统设置中配置AI模型API
echo.

pause