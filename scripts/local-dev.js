#!/usr/bin/env node
/*
 * 本地开发一键启动脚本（Linux/Windows 通用）
 * 功能：
 * 1) 自动检测并安装依赖（优先 pnpm，回退 yarn/npm）
 * 2) 自动检测/初始化数据库（Prisma：generate + db push）
 * 3) 并发启动前端(@aichat/frontend)与后端(@aichat/backend)开发服务
 * 使用：在仓库根目录执行 `npm start`
 */

/* UTF-8, no BOM */

const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

// ------------- 日志与工具 -------------
const COLORS = {
  reset: '\x1b[0m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
}

function logInfo(msg) {
  console.log(`${COLORS.blue}[INFO]${COLORS.reset} ${msg}`)
}
function logSuccess(msg) {
  console.log(`${COLORS.green}[SUCCESS]${COLORS.reset} ${msg}`)
}
function logWarn(msg) {
  console.log(`${COLORS.yellow}[WARNING]${COLORS.reset} ${msg}`)
}
function logError(msg) {
  console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${msg}`)
}

function isWin() {
  return process.platform === 'win32'
}

function commandExists(cmd) {
  try {
    const checker = isWin() ? 'where' : 'which'
    const args = [cmd]
    const res = spawnSync(checker, args, { stdio: 'ignore', shell: true })
    return res.status === 0
  } catch (_) {
    return false
  }
}

function runSync(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts })
  if (result.status !== 0) {
    throw new Error(`命令失败: ${cmd} ${args.join(' ')}`)
  }
}

function runAsync(label, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    shell: true,
    detached: !isWin(),
    env: process.env,
    cwd: opts.cwd || process.cwd(),
  })

  function prefix(type) {
    return type === 'backend' ? '[backend] ' : '[frontend] '
  }

  child.stdout.on('data', (data) => {
    process.stdout.write(prefix(label) + data.toString())
  })
  child.stderr.on('data', (data) => {
    process.stderr.write(prefix(label) + data.toString())
  })

  child.on('exit', (code) => {
    logWarn(`${label} 进程退出，代码: ${code}`)
  })

  return child
}

function killProcessTree(pid) {
  if (!pid) return
  try {
    if (isWin()) {
      // Windows: 使用 taskkill 结束进程树
      spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true })
    } else {
      // POSIX: 负 PID 发送给进程组
      try { process.kill(-pid, 'SIGTERM') } catch (_) {}
    }
  } catch (_) {
    // 忽略
  }
}

// ------------- 包管理器适配 -------------
function detectPackageManager() {
  const cwd = process.cwd()
  const hasNpmLock = fs.existsSync(path.join(cwd, 'package-lock.json'))
  const hasPnpmLock = fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))
  const hasPnpmWs = fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))
  const hasYarnLock = fs.existsSync(path.join(cwd, 'yarn.lock'))

  // 优先根据锁文件选择，避免跨管理器冲突
  if (hasNpmLock) return 'npm'
  if (hasPnpmLock || hasPnpmWs) return 'pnpm'
  if (hasYarnLock) return 'yarn'

  // 无锁文件时按可用性优先
  if (commandExists('pnpm')) return 'pnpm'
  if (commandExists('yarn')) return 'yarn'
  return 'npm'
}

function installDeps(pm) {
  logInfo(`准备安装依赖（包管理器: ${pm}）...`)
  try {
    if (pm === 'pnpm') {
      runSync('pnpm', ['install'])
    } else if (pm === 'yarn') {
      runSync('yarn', ['install'])
    } else {
      runSync('npm', ['install'])
    }
    logSuccess('依赖安装完成')
    return pm
  } catch (e) {
    logError('依赖安装失败。可检查网络或尝试手动执行安装命令。')
    // 退避与降级：尝试切换到其他包管理器
    const order = pm === 'pnpm' ? ['npm', 'yarn'] : pm === 'yarn' ? ['npm'] : []
    for (const next of order) {
      if (!commandExists(next)) continue
      try {
        logWarn(`尝试使用 ${next} 安装依赖...`)
        if (next === 'npm') runSync('npm', ['install'])
        else if (next === 'yarn') runSync('yarn', ['install'])
        logSuccess(`依赖安装完成（已切换为 ${next}）`)
        return next
      } catch (_) {
        // 继续尝试下一个
      }
    }
    throw e
  }
}

function workspaceRun(pm, workspace, script) {
  if (pm === 'pnpm') {
    return ['pnpm', ['--filter', workspace, script]]
  }
  if (pm === 'yarn') {
    return ['yarn', ['workspace', workspace, script]]
  }
  // npm >=7 workspaces
  return ['npm', ['run', '--workspace', workspace, script]]
}

function workspaceScript(pm, workspace, script) {
  const [cmd, args] = workspaceRun(pm, workspace, script)
  return { cmd, args }
}

// ------------- DB 检测与初始化 -------------
function ensureBackendEnv() {
  const backendDir = path.join(process.cwd(), 'packages', 'backend')
  const envFile = path.join(backendDir, '.env')
  const envExample = path.join(backendDir, '.env.example')

  // 若已从根 .env/.env.example 加载并具备关键变量（如 DATABASE_URL），则不需要包内 .env
  if (process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim()) {
    logInfo('已从根环境变量加载配置，跳过 packages/backend/.env 检查')
    return
  }

  if (!fs.existsSync(envFile)) {
    if (fs.existsSync(envExample)) {
      fs.copyFileSync(envExample, envFile)
      logWarn('未找到 packages/backend/.env，已从 .env.example 复制默认配置，请按需修改')
    } else {
      logWarn('未找到 packages/backend/.env 与 .env.example，将使用进程环境变量或 Prisma 默认配置')
    }
  }
}

function parseDatabaseUrl(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const m = raw.match(/^\s*DATABASE_URL\s*=\s*"?([^"\n\r]+)"?/m)
    if (m && m[1]) return m[1].trim()
  } catch (_) {}
  return null
}

function maybeDbFilePaths(dbUrl) {
  const backendDir = path.join(process.cwd(), 'packages', 'backend')
  const prismaDir = path.join(backendDir, 'prisma')
  const ret = []
  if (!dbUrl || !dbUrl.startsWith('file:')) return ret
  let p = dbUrl.replace(/^file:/, '')
  // 去掉可能的引号
  p = p.replace(/^\"|\"$/g, '')
  if (p.startsWith('./')) {
    // 常见：相对 schema.prisma，实际多见在 prisma 目录生成
    ret.push(path.join(prismaDir, p.slice(2)))
    ret.push(path.join(backendDir, p.slice(2)))
  } else {
    // 绝对或上层路径
    ret.push(path.isAbsolute(p) ? p : path.join(backendDir, p))
  }
  return ret
}

function ensureDatabase(pm) {
  const backendDir = path.join(process.cwd(), 'packages', 'backend')
  const envPath = path.join(backendDir, '.env')
  const dbUrl = fs.existsSync(envPath) ? parseDatabaseUrl(envPath) : null
  const candidates = maybeDbFilePaths(dbUrl)

  let inited = false
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      inited = true
      break
    }
  }

  // 保险：若未检测到 DB 文件，则生成 + push；若检测到也可以仅 generate（极低成本）
  const run = (script) => {
    const { cmd, args } = workspaceScript(pm, '@aichat/backend', script)
    runSync(cmd, args, { cwd: process.cwd() })
  }

  if (!inited) {
    logInfo('未检测到数据库文件，准备初始化 Prisma（generate + db:push）...')
    try {
      run('db:generate')
      run('db:push')
      logSuccess('数据库初始化完成')
    } catch (e) {
      logError('数据库初始化失败，请检查 Prisma 配置与环境变量')
      // 退避降级：调整引擎/日志后重试一次
      try {
        logWarn('2s 后重试一次 Prisma db:push（启用调试日志/二进制引擎）...')
        // 简单延迟
        const start = Date.now();
        while (Date.now() - start < 2000) {}
        process.env.PRISMA_LOG_LEVEL = process.env.PRISMA_LOG_LEVEL || 'debug'
        process.env.RUST_LOG = process.env.RUST_LOG || 'info'
        process.env.PRISMA_CLI_QUERY_ENGINE_TYPE = process.env.PRISMA_CLI_QUERY_ENGINE_TYPE || 'binary'
        run('db:push')
        logSuccess('数据库初始化已在重试后完成')
      } catch (_) {
        throw e
      }
    }
  } else {
    logInfo('检测到数据库已存在，执行 prisma generate 保持客户端同步...')
    try {
      run('db:generate')
      logSuccess('Prisma Client 已生成')
    } catch (e) {
      logWarn('Prisma Client 生成失败，请稍后手动执行')
    }
  }
}

// ------------- CLI 参数与交互 -------------
function parseArgs(argv) {
  const args = new Set(argv.map((s) => String(s).toLowerCase()))
  if (args.has('-h') || args.has('--help') || args.has('help')) {
    return { action: 'help' }
  }
  const isDev = args.has('-d') || args.has('--development') || args.has('-development') || args.has('--dev') || args.has('-dev') || args.has('dev')
  const isProd = args.has('-p') || args.has('--production') || args.has('-production') || args.has('--prod') || args.has('-prod') || args.has('prod')
  if (isDev && isProd) return { action: 'error', message: '不能同时指定开发与生产模式' }
  if (isDev) return { action: 'run', mode: 'dev' }
  if (isProd) return { action: 'run', mode: 'prod' }
  return { action: 'interactive' }
}

function printHelp() {
  console.log(`AI Chat 一键启动脚本\n\n用法:\n  npm start                  # 交互选择 1=开发, 2=生产\n  npm start -- -development  # 指定开发模式（npm需使用 -- 转发参数）\n  npm start -- -production   # 指定生产模式（npm需使用 -- 转发参数）\n\n别名脚本（无需 -- 转发，推荐）:\n  npm run start:dev\n  npm run start:prod\n\n其他支持参数(等价写法):\n  开发:  -d  --dev  dev  --development  -development  -dev\n  生产:  -p  --prod prod --production   -production   -prod\n\n说明:\n  - Windows/Linux 通用。\n  - 生产模式会先构建再启动；开发模式并发拉起前后端 dev 服务。\n`)
}

async function askInteractive() {
  return await new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
    console.log('\n请选择启动模式:')
    console.log('  1) 开发模式 (dev)')
    console.log('  2) 生产模式 (prod)')
    rl.question('输入序号并回车 (默认 1): ', (answer) => {
      rl.close()
      const v = String(answer || '').trim()
      if (v === '2') return resolve('prod')
      return resolve('dev')
    })
  })
}

// ------------- 主流程 -------------
async function main() {
  // 解析 CLI 参数 / 交互选择
  const parsed = parseArgs(process.argv.slice(2))
  if (parsed.action === 'help') {
    printHelp()
    return
  }
  if (parsed.action === 'error') {
    logError(parsed.message)
    printHelp()
    process.exit(1)
  }
  const mode = parsed.action === 'interactive' ? await askInteractive() : parsed.mode

  // 根据模式设置 NODE_ENV
  if (mode === 'dev') {
    if (process.env.NODE_ENV !== 'development') {
      logWarn(`开发模式下强制使用 NODE_ENV=development（当前: ${process.env.NODE_ENV || '未设置'}）`)
      process.env.NODE_ENV = 'development'
    }
  } else {
    if (process.env.NODE_ENV !== 'production') {
      logWarn(`生产模式下强制使用 NODE_ENV=production（当前: ${process.env.NODE_ENV || '未设置'}）`)
      process.env.NODE_ENV = 'production'
    }
  }
  // Node 版本检查
  const major = Number(process.versions.node.split('.')[0] || '0')
  if (isNaN(major) || major < 18) {
    logWarn(`检测到 Node 版本 ${process.versions.node}，建议 >= 18 以保证兼容性`)
  }

  let pm = detectPackageManager()
  logInfo(`使用包管理器: ${pm}`)

  // 依赖检查：根 node_modules 以及子包
  const rootNodeModules = path.join(process.cwd(), 'node_modules')
  const needInstall = !fs.existsSync(rootNodeModules)

  if (needInstall) {
    pm = installDeps(pm)
  } else {
    logSuccess('检测到依赖已安装，跳过安装')
  }

  // 统一加载根环境变量（集中化配置）
  // 优先根 .env，其次根 .env.example；不覆盖已有进程变量
  const rootEnv = path.join(process.cwd(), '.env')
  const rootEnvExample = path.join(process.cwd(), '.env.example')
  const loadEnvFile = (file) => {
    if (!fs.existsSync(file)) return false
    try {
      const raw = fs.readFileSync(file, 'utf8')
      for (const line of raw.split(/\r?\n/)) {
        if (!line || /^\s*#/.test(line)) continue
        const idx = line.indexOf('=')
        if (idx <= 0) continue
        const key = line.slice(0, idx).trim()
        let val = line.slice(idx + 1).trim()
        // 去掉首尾引号
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1)
        }
        if (!(key in process.env)) {
          process.env[key] = val
        }
      }
      return true
    } catch (e) {
      return false
    }
  }

  const loadedEnv = loadEnvFile(rootEnv) || loadEnvFile(rootEnvExample)
  if (loadedEnv) {
    logInfo('已加载根环境变量文件（.env/.env.example）')
  } else {
    logWarn('未找到根环境变量文件（.env/.env.example），将使用进程环境变量')
  }

  // 兜底：仅在开发模式设置默认 SQLite 路径
  if (mode === 'dev') {
    if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
      process.env.DATABASE_URL = 'file:./data/dev.db'
      logWarn('未检测到 DATABASE_URL，已为开发环境注入默认值 file:./data/dev.db')
    }
  } else {
    if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
      logWarn('生产模式未检测到 DATABASE_URL，请确认数据库配置，否则可能影响服务运行')
    }
  }

  // 后端环境与数据库
  ensureBackendEnv()
  try {
    ensureDatabase(pm)
  } catch (e) {
    logWarn('继续启动服务，但数据库可能未就绪，请留意后端日志')
  }

  // 显式设置各自包的工作目录，确保 Next/Prisma 等工具在正确目录解析配置
  const backendCwd = path.join(process.cwd(), 'packages', 'backend')
  const frontendCwd = path.join(process.cwd(), 'packages', 'frontend')

  if (mode === 'dev') {
    // 并发启动前后端（开发）
    logInfo('并发启动前端与后端（开发模式）...')
    const be = workspaceScript(pm, '@aichat/backend', 'dev')
    const fe = workspaceScript(pm, '@aichat/frontend', 'dev')
    const backend = runAsync('backend', be.cmd, be.args, { cwd: backendCwd })
    const frontend = runAsync('frontend', fe.cmd, fe.args, { cwd: frontendCwd })
    const shutdown = () => {
      logInfo('收到退出信号，正在关闭子进程...')
      if (backend.pid) killProcessTree(backend.pid)
      if (frontend.pid) killProcessTree(frontend.pid)
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  } else {
    // 生产：先构建再启动
    logInfo('生产模式：开始构建后端与前端...')
    try {
      runSync(...workspaceRun(pm, '@aichat/backend', 'build'))
      runSync(...workspaceRun(pm, '@aichat/frontend', 'build'))
      logSuccess('构建完成，启动服务...')
    } catch (e) {
      logError('构建失败，请检查日志')
      process.exit(1)
    }
    const be = workspaceScript(pm, '@aichat/backend', 'start')
    const fe = workspaceScript(pm, '@aichat/frontend', 'start')
    const backend = runAsync('backend', be.cmd, be.args, { cwd: backendCwd })
    const frontend = runAsync('frontend', fe.cmd, fe.args, { cwd: frontendCwd })
    const shutdown = () => {
      logInfo('收到退出信号，正在关闭生产服务...')
      if (backend.pid) killProcessTree(backend.pid)
      if (frontend.pid) killProcessTree(frontend.pid)
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }
}

main().catch((err) => {
  logError(err && err.message ? err.message : String(err))
  process.exit(1)
})
