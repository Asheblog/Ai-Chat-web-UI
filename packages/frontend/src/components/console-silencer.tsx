'use client';

/**
 * 在生产环境禁用浏览器端 console 输出。
 * - 仅在浏览器端生效（检测 window 存在）
 * - 生产环境（process.env.NODE_ENV === 'production'）时，将常见输出方法指向空函数
 * - 不影响服务端（Node）的日志输出
 */
;(() => {
  if (typeof window === 'undefined') return
  const isProd = process.env.NODE_ENV === 'production'
  if (!isProd) return

  const noop = () => {}
  const methods: Array<keyof Console> = ['log', 'info', 'debug', 'warn', 'error', 'trace']
  for (const key of methods) {
    try {
      // @ts-expect-error 动态覆盖console方法
      console[key] = noop
    } catch (_) {
      // 忽略不可写属性的覆盖错误
    }
  }
})()

export default function ConsoleSilencer() {
  return null
}
