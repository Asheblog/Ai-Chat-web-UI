import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Logger } from '../logger'
import {
  PythonHtmlExtractor,
  WEB_EXTRACTOR_MAX_INPUT_BYTES,
  WEB_EXTRACTOR_QUEUE_LIMIT,
  resolveExtractorScriptPath,
  resolvePythonInterpreter,
} from './python-extractor'

const NL_LITERAL = String.fromCharCode(10)

interface RecordedLog {
  level: 'debug' | 'warn' | 'error'
  message: string
  context?: Record<string, unknown>
}

const createRecordingLogger = (): { logger: Logger; records: RecordedLog[] } => {
  const records: RecordedLog[] = []
  const push = (level: RecordedLog['level']) => (message: string, context?: unknown) => {
    records.push({
      level,
      message,
      context: context && typeof context === 'object' ? (context as Record<string, unknown>) : undefined,
    })
  }
  return {
    records,
    logger: { debug: push('debug'), info: () => undefined, warn: push('warn'), error: push('error') },
  }
}

const summarise = (records: RecordedLog[], level: RecordedLog['level']): RecordedLog[] =>
  records.filter((record) => record.level === level)

interface FakeWorkerOptions {
  /** 每次进程启动都追加一行 pid，用于观察进程重建与复用。 */
  pidFile: string
  /** 返回给调用方的正文；默认回显 URL。 */
  reply?: (job: Record<string, unknown>) => Record<string, unknown>
  /** 首个任务前的等待毫秒数（模拟慢任务）。 */
  delayMs?: number
  /** 是否在初次启动后的第一个任务上崩溃（模拟 worker 退出）。 */
  crashOnFirstJob?: boolean
  /** 是否写入状态文件记录“第一次运行”。 */
  onceStateFile?: string
}

const buildFakeWorkerSource = (options: FakeWorkerOptions): string => {
  const lines: string[] = [
    "const fs = require('node:fs')",
    'const NL = String.fromCharCode(10)',
    'const pidFile = ' + JSON.stringify(options.pidFile),
    'const onceStateFile = ' + JSON.stringify(options.onceStateFile ?? null),
    'const delayMs = ' + String(options.delayMs ?? 0),
    'const crashOnFirstJob = ' + (options.crashOnFirstJob ? 'true' : 'false'),
    'fs.appendFileSync(pidFile, String(process.pid) + NL)',
    '// 状态文件在“收到第一个任务”时写入：进程可能在收到任务前被杀，避免把它当成已消费。',
    'const markFirstJob = () => {',
    '  if (!onceStateFile) return true',
    '  if (fs.existsSync(onceStateFile)) return false',
    '  fs.writeFileSync(onceStateFile, "1")',
    '  return true',
    '}',
    "const send = (payload) => { process.stdout.write(JSON.stringify(payload) + NL) }",
    "send({ type: 'ready' })",
    'let buffer = ""',
    'process.stdin.setEncoding("utf8")',
    'process.stdin.on("data", async (chunk) => {',
    '  buffer += chunk',
    '  let index = buffer.indexOf(NL)',
    '  while (index >= 0) {',
    '    const line = buffer.slice(0, index)',
    '    buffer = buffer.slice(index + 1)',
    '    index = buffer.indexOf(NL)',
    '    if (!line.trim()) continue',
    '    const job = JSON.parse(line)',
    '    const firstJob = markFirstJob()',
    '    // 首个任务慢（或崩溃），重建后的进程立即返回：验证超时/取消后能正常服务',
    '    const effectiveDelayMs = onceStateFile && !firstJob ? 0 : delayMs',
    '    if (effectiveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, effectiveDelayMs))',
    '    if (crashOnFirstJob && firstJob) {',
    '      process.exit(7)',
    '    }',
    '    const reply = ' + (options.reply ? 'REPLY_PLACEHOLDER' : 'null'),
    '    const payload = reply',
    '      ? { id: job.id, ok: true, document: reply(job) }',
    '      : { id: job.id, ok: true, document: { title: "Fake Title", content: "fake body " + job.url } }',
    '    send(payload)',
    '  }',
    '})',
  ]
  const source = lines.join(NL_LITERAL) + NL_LITERAL
  if (!options.reply) return source
  return source.replace('REPLY_PLACEHOLDER', options.reply.toString())
}

interface FakeWorker {
  scriptPath: string
  pidFile: string
  readPids: () => number[]
}

const createFakeWorker = (tempDir: string, name: string, options: Partial<FakeWorkerOptions> = {}): FakeWorker => {
  const pidFile = path.join(tempDir, name + '-pids.txt')
  const scriptPath = path.join(tempDir, name + '.cjs')
  fs.writeFileSync(
    scriptPath,
    buildFakeWorkerSource({
      pidFile,
      reply: options.reply,
      delayMs: options.delayMs,
      crashOnFirstJob: options.crashOnFirstJob,
      onceStateFile: options.onceStateFile,
    }),
    'utf8',
  )
  const readPids = (): number[] =>
    fs.existsSync(pidFile)
      ? fs
          .readFileSync(pidFile, 'utf8')
          .split(NL_LITERAL)
          .filter(Boolean)
          .map((value) => Number.parseInt(value, 10))
      : []
  return { scriptPath, pidFile, readPids }
}

const createNodeRunner = (scriptPath: string, tempDir: string, extra: Partial<Record<string, never>> = {}) =>
  new PythonHtmlExtractor({
    pythonPath: process.execPath,
    scriptPath,
    idleTimeoutMs: 60_000,
    env: { ...process.env, ...extra },
  })

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('PythonHtmlExtractor', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-python-extractor-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('extracts content through the persistent worker and keeps the page URL', async () => {
    const fake = createFakeWorker(tempDir, 'echo')
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    try {
      const document = await extractor.extract('<html><body>hi</body></html>', 'https://example.com/article-1')
      expect(document).toEqual({
        title: 'Fake Title',
        content: 'fake body https://example.com/article-1',
      })
    } finally {
      await extractor.close()
    }
  })

  it('reuses one worker for sequential tasks', async () => {
    const fake = createFakeWorker(tempDir, 'reuse')
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    try {
      await extractor.extract('<html><body>one</body></html>', 'https://example.com/one')
      await extractor.extract('<html><body>two</body></html>', 'https://example.com/two')
      expect(fake.readPids()).toHaveLength(1)
    } finally {
      await extractor.close()
    }
  })

  it('returns null and reports the missing capability once when no interpreter resolves', async () => {
    const { logger, records } = createRecordingLogger()
    const extractor = new PythonHtmlExtractor({ env: { PATH: '' }, logger })
    try {
      expect(await extractor.extract('<html><body>hi</body></html>', 'https://example.com/a')).toBeNull()
      expect(await extractor.extract('<html><body>hi</body></html>', 'https://example.com/b')).toBeNull()
      const warnings = summarise(records, 'warn').filter((record) => record.message.includes('不可用'))
      expect(warnings).toHaveLength(1)
    } finally {
      await extractor.close()
    }
  })

  it('returns null when the worker cannot import its dependencies', async () => {
    const { logger, records } = createRecordingLogger()
    const scriptPath = path.join(tempDir, 'broken-python.cjs')
    fs.writeFileSync(
      scriptPath,
      [
        "process.stderr.write('web-extractor: trafilatura unavailable' + String.fromCharCode(10))",
        'process.exit(3)',
      ].join(NL_LITERAL) + NL_LITERAL,
      'utf8',
    )
    const spawnMarker = path.join(tempDir, 'broken-spawns.txt')
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath,
      logger,
      env: { ...process.env, FAKE_MARKER: spawnMarker },
      idleTimeoutMs: 60_000,
    })
    try {
      expect(await extractor.extract('<html><body>hi</body></html>', 'https://example.com/a')).toBeNull()
      // 冷却期内的第二次调用直接返回 null，不重复启动失败进程。
      expect(await extractor.extract('<html><body>hi</body></html>', 'https://example.com/b')).toBeNull()
      const warnings = summarise(records, 'warn')
      expect(warnings).toHaveLength(1)
      expect(String(warnings[0]?.context?.reason)).toContain('trafilatura unavailable')
      expect(extractor.describeState().cooldownRemainingMs).toBeGreaterThan(0)
    } finally {
      await extractor.close()
    }
  })

  it('skips oversized HTML without starting a worker', async () => {
    const fake = createFakeWorker(tempDir, 'oversized')
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      maxInputBytes: 512,
      idleTimeoutMs: 60_000,
    })
    try {
      const html = '<html><body>' + 'x'.repeat(2048) + '</body></html>'
      expect(await extractor.extract(html, 'https://example.com/big')).toBeNull()
      expect(fake.readPids()).toHaveLength(0)
    } finally {
      await extractor.close()
    }
  })

  it('returns null for empty HTML without starting a worker', async () => {
    const fake = createFakeWorker(tempDir, 'empty-input')
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    try {
      expect(await extractor.extract('   ', 'https://example.com/empty')).toBeNull()
      expect(fake.readPids()).toHaveLength(0)
    } finally {
      await extractor.close()
    }
  })

  it('returns null when the worker reports no body', async () => {
    const fake = createFakeWorker(tempDir, 'nobody', { reply: () => null })
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    try {
      expect(await extractor.extract('<html><body></body></html>', 'https://example.com/none')).toBeNull()
    } finally {
      await extractor.close()
    }
  })

  it('times out a hung task, kills its worker and serves the next task from a fresh one', async () => {
    const onceStateFile = path.join(tempDir, 'hang-once.flag')
    const fake = createFakeWorker(tempDir, 'hang-once', { delayMs: 8000, onceStateFile })
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 1200,
      idleTimeoutMs: 60_000,
    })
    try {
      expect(await extractor.extract('<html><body>slow</body></html>', 'https://example.com/slow')).toBeNull()
      const document = await extractor.extract('<html><body>fast</body></html>', 'https://example.com/fast')
      expect(document?.content).toContain('https://example.com/fast')
      expect(fake.readPids().length).toBeGreaterThanOrEqual(2)
    } finally {
      await extractor.close()
    }
  })

  it('aborts the in-flight task without stalling the queued one', async () => {
    const fake = createFakeWorker(tempDir, 'abort', { delayMs: 1200 })
    // 单任务时限高于夹具延迟，确保排队任务不会因自身处理时间被判超时。
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 3000,
      idleTimeoutMs: 60_000,
    })
    try {
      const controller = new AbortController()
      const started = Date.now()
      const aborted = extractor.extract('<html><body>a</body></html>', 'https://example.com/a', {
        signal: controller.signal,
      })
      const queued = extractor.extract('<html><body>b</body></html>', 'https://example.com/b')
      await wait(120)
      controller.abort()

      expect(await aborted).toBeNull()
      // 取消立即结算，不等被杀进程跑完 1200ms 夹具延迟。
      expect(Date.now() - started).toBeLessThan(900)

      const document = await queued
      expect(document?.content).toContain('https://example.com/b')
      expect(fake.readPids().length).toBeGreaterThanOrEqual(1)
    } finally {
      await extractor.close()
    }
  })

  it('returns null immediately for an already aborted signal', async () => {
    const fake = createFakeWorker(tempDir, 'pre-abort')
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    const controller = new AbortController()
    controller.abort()
    try {
      expect(
        await extractor.extract('<html><body>x</body></html>', 'https://example.com/x', {
          signal: controller.signal,
        }),
      ).toBeNull()
      expect(fake.readPids()).toHaveLength(0)
    } finally {
      await extractor.close()
    }
  })

  it('does not start the next task until the cancelled worker has exited', async () => {
    const fake = createFakeWorker(tempDir, 'exit-gate', { delayMs: 1200 })
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 5000,
      idleTimeoutMs: 60_000,
    })
    try {
      const controller = new AbortController()
      const running = extractor.extract('<html><body>a</body></html>', 'https://example.com/a', {
        signal: controller.signal,
      })
      const waiting = extractor.extract('<html><body>c</body></html>', 'https://example.com/c')

      const deadline = Date.now() + 5000
      while (!extractor.describeState().workerReady && Date.now() < deadline) await wait(10)
      expect(extractor.describeState().workerReady).toBe(true)

      controller.abort()
      // 同一个 tick：旧 child 的 exit 尚未送达，此时队列里已有 c，再入队 d。
      const late = extractor.extract('<html><body>d</body></html>', 'https://example.com/d')

      // 门控必须保留到 exit 被观察到：没有任务被启动，c/d 都还在队列里。
      const stateRightAfterAbort = extractor.describeState()
      expect(stateRightAfterAbort.active).toBe(false)
      expect(stateRightAfterAbort.queued).toBe(2)
      expect(fake.readPids()).toHaveLength(1)

      expect(await running).toBeNull()
      expect((await waiting)?.content).toContain('https://example.com/c')
      expect((await late)?.content).toContain('https://example.com/d')
      // 旧进程退出后只重建一个进程，为剩余两个任务服务。
      expect(fake.readPids()).toHaveLength(2)
    } finally {
      await extractor.close()
    }
  })

  it('counts queue waiting time inside the per-task timeout', async () => {
    const fake = createFakeWorker(tempDir, 'queue-deadline', { delayMs: 600 })
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 5000,
      idleTimeoutMs: 60_000,
    })
    try {
      const active = extractor.extract('<html><body>a</body></html>', 'https://example.com/long', {
        timeoutMs: 2000,
      })
      const queuedStarted = Date.now()
      const queued = extractor.extract('<html><body>b</body></html>', 'https://example.com/queued', {
        timeoutMs: 300,
      })

      // 在途任务占住 worker 超过 500ms，排队任务在 300ms 时限内先到期，不被排队拉长到 1.5s+。
      expect(await queued).toBeNull()
      expect(Date.now() - queuedStarted).toBeLessThan(1200)
      expect((await active)?.content).toContain('https://example.com/long')
    } finally {
      await extractor.close()
    }
  })

  it('retries after a transient startup failure instead of disabling the extractor', async () => {
    const onceStateFile = path.join(tempDir, 'broken-once.flag')
    const scriptPath = path.join(tempDir, 'broken-once.cjs')
    // 首次启动缺依赖直接退出，之后正常服务：模拟可恢复故障。
    fs.writeFileSync(
      scriptPath,
      [
        "const fs = require('node:fs')",
        'const NL = String.fromCharCode(10)',
        'const flag = ' + JSON.stringify(onceStateFile),
        'if (!fs.existsSync(flag)) {',
        '  fs.writeFileSync(flag, "1")',
        "  process.stderr.write('web-extractor: trafilatura unavailable' + NL)",
        '  process.exit(3)',
        '}',
        "const send = (payload) => { process.stdout.write(JSON.stringify(payload) + NL) }",
        "send({ type: 'ready' })",
        'let buffer = ""',
        'process.stdin.setEncoding("utf8")',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk',
        '  let i = buffer.indexOf(NL)',
        '  while (i >= 0) {',
        '    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); i = buffer.indexOf(NL)',
        '    if (!line.trim()) continue',
        '    const job = JSON.parse(line)',
        '    send({ id: job.id, ok: true, document: { content: "recovered " + job.url } })',
        '  }',
        '})',
      ].join(NL_LITERAL) + NL_LITERAL,
      'utf8',
    )
    const { logger, records } = createRecordingLogger()
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath,
      timeoutMs: 3000,
      idleTimeoutMs: 60_000,
      retryCooldownMs: 120,
      logger,
    })
    try {
      expect(await extractor.extract('<html><body>a</body></html>', 'https://example.com/first')).toBeNull()
      // 冷却期内直接返回 null，不重复制造启动失败。
      expect(await extractor.extract('<html><body>b</body></html>', 'https://example.com/cooling')).toBeNull()
      expect(extractor.describeState().cooldownRemainingMs).toBeGreaterThan(0)

      await wait(200)
      const document = await extractor.extract('<html><body>c</body></html>', 'https://example.com/retry')
      expect(document?.content).toContain('https://example.com/retry')
      expect(summarise(records, 'warn').length).toBeGreaterThanOrEqual(1)
    } finally {
      await extractor.close()
    }
  })

  it('drops requests beyond the bounded queue instead of parking them', async () => {
    const fake = createFakeWorker(tempDir, 'queue', { delayMs: 400 })
    // 单任务时限放宽：这个用例验证的是队列上界与立即丢弃，而不是时限。
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 5000,
      idleTimeoutMs: 60_000,
    })
    const queuedCount = WEB_EXTRACTOR_QUEUE_LIMIT
    try {
      const active = extractor.extract('<html><body>0</body></html>', 'https://example.com/0')
      await wait(20)
      const queued = Array.from({ length: queuedCount }, (_value, index) =>
        extractor.extract('<html><body>' + index + '</body></html>', 'https://example.com/q' + index),
      )
      const overflowStarted = Date.now()
      const overflow = await extractor.extract('<html><body>3</body></html>', 'https://example.com/overflow')
      expect(overflow).toBeNull()
      expect(Date.now() - overflowStarted).toBeLessThan(200)

      expect((await active)?.content).toContain('https://example.com/0')
      for (const document of await Promise.all(queued)) {
        expect(document?.content).toContain('https://example.com/q')
      }
      expect(fake.readPids()).toHaveLength(1)
    } finally {
      await extractor.close()
    }
  })

  it('recovers when a ready worker crashes mid-task', async () => {
    const onceStateFile = path.join(tempDir, 'crash-once.flag')
    const fake = createFakeWorker(tempDir, 'crash-once', { crashOnFirstJob: true, onceStateFile })
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      timeoutMs: 3000,
      idleTimeoutMs: 60_000,
    })
    try {
      expect(await extractor.extract('<html><body>a</body></html>', 'https://example.com/crash')).toBeNull()
      const document = await extractor.extract('<html><body>b</body></html>', 'https://example.com/after')
      expect(document?.content).toContain('https://example.com/after')
      expect(fake.readPids()).toHaveLength(2)
    } finally {
      await extractor.close()
    }
  })

  it('shuts the worker down after the idle timeout and respawns on demand', async () => {
    const fake = createFakeWorker(tempDir, 'idle')
    const extractor = new PythonHtmlExtractor({
      pythonPath: process.execPath,
      scriptPath: fake.scriptPath,
      idleTimeoutMs: 150,
      timeoutMs: 3000,
    })
    try {
      await extractor.extract('<html><body>one</body></html>', 'https://example.com/one')
      expect(fake.readPids()).toHaveLength(1)
      await wait(600)
      await extractor.extract('<html><body>two</body></html>', 'https://example.com/two')
      const pids = fake.readPids()
      expect(pids).toHaveLength(2)
      expect(pids[0]).not.toBe(pids[1])
    } finally {
      await extractor.close()
    }
  })

  it('settles pending work and stops accepting tasks after close', async () => {
    const fake = createFakeWorker(tempDir, 'close', { delayMs: 1500 })
    const extractor = createNodeRunner(fake.scriptPath, tempDir)
    const pending = extractor.extract('<html><body>a</body></html>', 'https://example.com/pending')
    const queued = extractor.extract('<html><body>b</body></html>', 'https://example.com/queued')
    await wait(100)
    await extractor.close()
    expect(await pending).toBeNull()
    expect(await queued).toBeNull()
    expect(await extractor.extract('<html><body>c</body></html>', 'https://example.com/closed')).toBeNull()
  })
})

describe('resolvePythonInterpreter', () => {
  it('prefers APP_WEB_EXTRACTOR_PYTHON over PATH lookups', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-python-resolve-'))
    try {
      const explicit = path.join(tempDir, 'venv-python')
      fs.writeFileSync(explicit, 'stub', 'utf8')
      const resolved = resolvePythonInterpreter({
        env: { PATH: '', APP_WEB_EXTRACTOR_PYTHON: explicit } as NodeJS.ProcessEnv,
      })
      expect(resolved).toBe(explicit)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('returns undefined when nothing matches an empty PATH', () => {
    expect(resolvePythonInterpreter({ env: { PATH: '' } as NodeJS.ProcessEnv })).toBeUndefined()
  })

  it('ignores a configured interpreter path that does not exist', () => {
    const resolved = resolvePythonInterpreter({
      env: { PATH: '', APP_WEB_EXTRACTOR_PYTHON: path.join(os.tmpdir(), 'no-such-python-xyz') } as NodeJS.ProcessEnv,
    })
    expect(resolved).toBeUndefined()
  })
})

describe('resolveExtractorScriptPath', () => {
  it('finds the worker script by walking up from the working directory', () => {
    const resolved = resolveExtractorScriptPath({
      startDir: path.join(process.cwd(), 'src', 'utils', 'web-retrieval'),
      env: {} as NodeJS.ProcessEnv,
    })
    expect(resolved).toBeTruthy()
    expect(resolved?.endsWith(path.join('scripts', 'web-extractor', 'extract_worker.py'))).toBe(true)
  })

  it('prefers an explicit script path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-script-resolve-'))
    try {
      const explicit = path.join(tempDir, 'worker.py')
      fs.writeFileSync(explicit, 'pass', 'utf8')
      expect(resolveExtractorScriptPath({ explicitPath: explicit, env: {} as NodeJS.ProcessEnv })).toBe(explicit)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

const realPython = resolvePythonInterpreter({ env: process.env })
const trafilaturaAvailable = (() => {
  if (!realPython) return false
  try {
    const probe = spawnSync(realPython, ['-c', 'import trafilatura'], { timeout: 60_000 })
    return probe.status === 0
  } catch {
    return false
  }
})()

const realTrafilaturaTest = trafilaturaAvailable ? it : it.skip

const REAL_FIXTURE_HTML = [
  '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
  '<title>受限检索改造：正文质量判定</title>',
  '<meta name="description" content="说明正文质量判定与降级策略。">',
  '</head><body><nav><a href="/">首页</a><a href="/news">新闻中心</a></nav>',
  '<article><h1>受限检索改造：正文质量判定</h1>',
  '<p>我们先把已经下载的 HTML 交给本地提取器，避免重复下载。这一段用于验证提取器能否在中文页面上取出正文，而不是把导航当成内容。</p>',
  '<p>第二段描述取消语义：调用方取消时立刻结算，不占用队列。第三段描述空闲退出：一段时间没有任务后进程自行结束，避免容器里常驻无尽负载。</p>',
  '<p>表格信息同样重要：时间、数值列需要在正文中保留，供后续结构化处理使用。最后一段包含较长文本，用于让提取器按精确模式返回结果。</p>',
  '</article><footer>版权所有</footer></body></html>',
].join('')

describe('extractHtmlWithPython (real Trafilatura)', () => {
  realTrafilaturaTest('extracts Chinese article body and drops navigation', async () => {
    const extractor = new PythonHtmlExtractor({
      pythonPath: realPython,
      timeoutMs: 20000,
      idleTimeoutMs: 1000,
    })
    try {
      const document = await extractor.extract(REAL_FIXTURE_HTML, 'https://example.com/real-article')
      expect(document).not.toBeNull()
      expect(document?.title).toContain('受限检索改造')
      expect(document?.content).toContain('第二段描述取消语义')
      expect(document?.content).not.toContain('新闻中心')
      expect(document?.excerpt).toBeTruthy()
    } finally {
      await extractor.close()
    }
  })
})

describe('defaults', () => {
  it('keeps the documented input and queue limits', () => {
    expect(WEB_EXTRACTOR_MAX_INPUT_BYTES).toBe(1024 * 1024)
    expect(WEB_EXTRACTOR_QUEUE_LIMIT).toBe(2)
  })
})
