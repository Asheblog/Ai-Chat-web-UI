'use client'

type ConsoleTarget = Pick<Console, 'log' | 'info' | 'debug' | 'warn' | 'error' | 'trace'>

const NOOP = () => {}

/**
 * 生产环境仅静音 log/info/debug，保留 warn/error 供 Worker、渲染与品牌降级诊断。
 * 导出纯函数便于测试，副作用只在浏览器端执行一次。
 */
export function configureProductionConsole(
  target: ConsoleTarget,
  env: string | undefined = process.env.NODE_ENV,
) {
  if (env !== 'production') return
  for (const key of ['log', 'info', 'debug'] as const) {
    try {
      target[key] = NOOP
    } catch {
      // 某些运行时会锁定 console 方法，忽略不可写属性。
    }
  }
}

let installed = false

export function installProductionConsoleSilencer(env: string | undefined = process.env.NODE_ENV) {
  if (env !== 'production') return
  if (installed || typeof window === 'undefined') return
  installed = true
  configureProductionConsole(console)
}

if (typeof window !== 'undefined') {
  installProductionConsoleSilencer()
}

export default function ConsoleSilencer() {
  return null
}
