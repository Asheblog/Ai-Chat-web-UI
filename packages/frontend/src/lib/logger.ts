/*
 * 前端开发日志工具：在开发环境或设置 NEXT_PUBLIC_DEBUG=true 时输出详细日志
 */
export const FrontendLogger = (() => {
  const isDebug =
    (typeof window !== 'undefined' && (window as any).__DEBUG__) ||
    process.env.NEXT_PUBLIC_DEBUG === 'true' ||
    process.env.NODE_ENV !== 'production'

  const fmt = (level: 'log' | 'info' | 'warn' | 'error', ...args: any[]) => {
    const ts = new Date().toISOString()
    const prefix = `[FE][${ts}][${level.toUpperCase()}]`
    // eslint-disable-next-line no-console
    console[level](prefix, ...args)
  }

  return {
    debug: (...args: any[]) => isDebug && fmt('log', ...args),
    info: (...args: any[]) => isDebug && fmt('info', ...args),
    warn: (...args: any[]) => fmt('warn', ...args),
    error: (...args: any[]) => fmt('error', ...args),
  }
})()
