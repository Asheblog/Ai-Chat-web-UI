import { describe, expect, it, vi } from 'vitest'
import { configureProductionConsole } from '@/components/console-silencer'

const createConsole = () => ({
  log: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
})

describe('ConsoleSilencer', () => {
  it('生产环境只静音噪音级别，保留 warn/error', () => {
    const target = createConsole()
    const originalLog = target.log
    const originalWarn = target.warn
    const originalError = target.error

    configureProductionConsole(target, 'production')

    expect(target.log).not.toBe(originalLog)
    expect(target.warn).toBe(originalWarn)
    expect(target.error).toBe(originalError)
    target.log('hidden')
    target.info('hidden')
    target.debug('hidden')
    target.warn('worker failed')
    target.error('render failed')

    expect(target.warn).toHaveBeenCalledWith('worker failed')
    expect(target.error).toHaveBeenCalledWith('render failed')
  })

  it('非生产环境不修改 console', () => {
    const target = createConsole()
    const originalLog = target.log
    const originalWarn = target.warn

    configureProductionConsole(target, 'development')

    expect(target.log).toBe(originalLog)
    expect(target.warn).toBe(originalWarn)
  })
})
