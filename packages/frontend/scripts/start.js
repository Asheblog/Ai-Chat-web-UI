#!/usr/bin/env node
/* UTF-8, no BOM */
// 前端生产启动脚本：
// - 优先使用 Next.js standalone 运行方式：.next/standalone/server.js
// - 启动前加载根 .env（以及包内 .env，如存在）到 process.env，确保重写代理可用
// - 若未生成 standalone，则回退到 `next start`

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function loadEnv(file) {
  try {
    if (!fs.existsSync(file)) return
    const raw = fs.readFileSync(file, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue
      const idx = line.indexOf('=')
      if (idx <= 0) continue
      const key = line.slice(0, idx).trim()
      let val = line.slice(idx + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
  } catch (_) {}
}

function main() {
  // 加载环境变量：优先仓库根，其次当前包目录
  const repoRoot = path.resolve(__dirname, '../../..')
  loadEnv(path.join(repoRoot, '.env'))
  loadEnv(path.join(process.cwd(), '.env'))

  const standalone = path.join(process.cwd(), '.next', 'standalone', 'server.js')
  if (fs.existsSync(standalone)) {
    console.log('[frontend] Using standalone server:', standalone)
    const r = spawnSync(process.execPath, [standalone], { stdio: 'inherit', shell: true, env: process.env, cwd: process.cwd() })
    process.exit(r.status || 0)
  }

  console.warn('[frontend] Standalone server not found, fallback to `next start`.')
  const r = spawnSync('npx', ['--yes', 'next', 'start', '-H', '0.0.0.0', '-p', String(process.env.FRONTEND_PORT || 3000)], {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    cwd: process.cwd(),
  })
  process.exit(r.status || 0)
}

main()

