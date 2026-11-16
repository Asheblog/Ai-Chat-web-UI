import { join, resolve } from 'node:path'
import {
  buildTraceLogFilePath,
  defaultLegacyTraceLogDirs,
  resolveTaskTraceLogDir,
  resolveTraceLogPath,
} from '../../task-trace'

const appPath = (...segments: string[]) => resolve('/app', ...segments)

describe('task trace log dir resolution', () => {
  it('prefers TASK_TRACE_LOG_DIR over LOG_DIR', () => {
    const dir = resolveTaskTraceLogDir({
      env: { TASK_TRACE_LOG_DIR: '/srv/traces', LOG_DIR: '/var/log/app' },
      cwd: '/repo',
      containerAppRoot: false,
    })
    expect(dir).toBe(resolve('/srv/traces'))
  })

  it('derives task-trace under LOG_DIR when only LOG_DIR is set', () => {
    const dir = resolveTaskTraceLogDir({
      env: { LOG_DIR: '/var/log/app' },
      cwd: '/repo',
      containerAppRoot: false,
    })
    expect(dir).toBe(resolve('/var/log/app/task-trace'))
  })

  it('uses the persistent container log root when running inside the image', () => {
    const dir = resolveTaskTraceLogDir({ env: {}, cwd: appPath('packages', 'backend'), containerAppRoot: true })
    expect(dir).toBe(appPath('logs', 'task-trace'))
  })

  it('falls back to the working directory for host development', () => {
    const dir = resolveTaskTraceLogDir({ env: {}, cwd: resolve('/repo/packages/backend'), containerAppRoot: false })
    expect(dir).toBe(resolve('/repo/packages/backend/logs/task-trace'))
  })

  it('builds the per-trace file name', () => {
    expect(buildTraceLogFilePath(appPath('logs', 'task-trace'), 42)).toBe(
      join(appPath('logs', 'task-trace'), 'trace-42.log'),
    )
  })
})

describe('stored trace log path resolution', () => {
  const baseDir = appPath('logs', 'task-trace')
  const legacyDirs = [appPath('packages', 'backend', 'logs', 'task-trace')]

  it('uses the stored path when that file still exists in an allowed directory', () => {
    const stored = join(legacyDirs[0], 'trace-5.log')
    const remapped = join(baseDir, 'trace-5.log')
    const result = resolveTraceLogPath({
      storedPath: stored,
      traceId: 5,
      baseDir,
      legacyDirs,
      exists: (p) => p === stored || p === remapped,
    })
    expect(result).toEqual({ path: stored, via: 'stored', reason: 'stored', expectedFileName: 'trace-5.log' })
  })

  it('reports a missing file under the current base dir without inventing another one', () => {
    const result = resolveTraceLogPath({
      storedPath: join(baseDir, 'trace-5.log'),
      traceId: 5,
      baseDir,
      legacyDirs,
      exists: () => false,
    })
    expect(result.path).toBeNull()
    expect(result.via).toBeNull()
    expect(result.reason).toBe('missing')
  })

  it('remaps a known legacy app directory to the current base dir', () => {
    const legacy = join(legacyDirs[0], 'trace-5.log')
    const current = join(baseDir, 'trace-5.log')
    const result = resolveTraceLogPath({
      storedPath: legacy,
      traceId: 5,
      baseDir,
      legacyDirs,
      exists: (p) => p === current,
    })
    expect(result).toEqual({ path: current, via: 'legacy-remap', reason: 'legacy-remap', expectedFileName: 'trace-5.log' })
  })

  it('refuses to remap a legacy file that belongs to another trace', () => {
    const legacy = join(legacyDirs[0], 'trace-9.log')
    const result = resolveTraceLogPath({
      storedPath: legacy,
      traceId: 5,
      baseDir,
      legacyDirs,
      exists: (p) => p.endsWith('trace-5.log'),
    })
    expect(result.path).toBeNull()
    expect(result.reason).toBe('legacy-name-mismatch')
  })

  it('refuses arbitrary stored paths outside known trace directories even when they exist', () => {
    const result = resolveTraceLogPath({
      storedPath: resolve('/tmp/whatever/trace-5.log'),
      traceId: 5,
      baseDir,
      legacyDirs,
      exists: () => true,
    })
    expect(result.path).toBeNull()
    expect(result.reason).toBe('legacy-root-unknown')
  })

  it('reports an empty stored path distinctly', () => {
    const result = resolveTraceLogPath({ storedPath: null, traceId: 5, baseDir, legacyDirs, exists: () => false })
    expect(result.path).toBeNull()
    expect(result.reason).toBe('empty')
  })

  it('includes the on-image legacy dir and an env override in default legacy dirs', () => {
    const dirs = defaultLegacyTraceLogDirs({
      baseDir,
      cwd: appPath('packages', 'backend'),
      env: { TASK_TRACE_LEGACY_LOG_DIRS: '/mnt/old-traces' },
    })
    expect(dirs).toContain(legacyDirs[0])
    expect(dirs).toContain(resolve('/mnt/old-traces'))
    expect(dirs).not.toContain(baseDir)
  })
})
