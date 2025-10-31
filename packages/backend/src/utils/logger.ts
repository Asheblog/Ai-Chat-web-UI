/*
 * 后端简易日志工具：在开发环境或 LOG_LEVEL=debug 时打印更详细的日志
 */
export const BackendLogger = (() => {
  const level = (process.env.LOG_LEVEL || (process.env.NODE_ENV !== 'production' ? 'debug' : 'info')).toLowerCase()
  const allowDebug = level === 'debug'

  function fmt(prefix: string, ...args: any[]) {
    const ts = new Date().toISOString()
    // eslint-disable-next-line no-console
    console.log(`[BE][${ts}]${prefix}`, ...args)
  }

  return {
    debug: (...args: any[]) => allowDebug && fmt('[DEBUG]', ...args),
    info: (...args: any[]) => fmt('[INFO]', ...args),
    warn: (...args: any[]) => fmt('[WARN]', ...args),
    error: (...args: any[]) => fmt('[ERROR]', ...args),
  }
})()
