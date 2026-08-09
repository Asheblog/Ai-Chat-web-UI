import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { DockerExecutor, parseMountInfo, WORKSPACE_CONTAINER_NAME_PREFIX, log } from './docker-executor'
import { WorkspaceServiceError } from './workspace-errors'
import type { WorkspaceConfig } from '../../config/app-config'

const baseConfig = (): WorkspaceConfig => ({
  rootDir: '/tmp/workspaces',
  artifactTtlMinutes: 60,
  idleTtlMinutes: 1440,
  cleanupIntervalMs: 60_000,
  maxWorkspaceBytes: 1024 * 1024,
  maxArtifactBytes: 1024 * 1024,
  maxArtifactsPerMessage: 20,
  runTimeoutMs: 120_000,
  maxConcurrentRuns: 1,
  runQueueTimeoutMs: 50,
  dockerImage: 'python:3.11-slim',
  dockerCpu: '0.5',
  dockerMemory: '512m',
  dockerPidsLimit: 128,
  artifactSigningSecret: 'test',
  listMaxEntries: 500,
  readMaxChars: 120_000,
  gitCloneTimeoutMs: 60_000,
  pythonInstallTimeoutMs: 600_000,
})

type MockChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: jest.Mock; end: jest.Mock }
  kill: jest.Mock
}

const createMockChild = (): MockChild => {
  const child = new EventEmitter() as MockChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: jest.fn(), end: jest.fn() }
  child.kill = jest.fn(() => {
    queueMicrotask(() => child.emit('close', 1))
  })
  return child
}

describe('DockerExecutor', () => {
  const originalHostname = process.env.HOSTNAME

  afterEach(() => {
    if (originalHostname === undefined) {
      delete process.env.HOSTNAME
    } else {
      process.env.HOSTNAME = originalHostname
    }
  })

  it('queues runs and times out waiting for a slot', async () => {
    delete process.env.HOSTNAME
    const children: MockChild[] = []
    const spawnFn = jest.fn((_cmd: string, args: string[]) => {
      const child = createMockChild()
      children.push(child)
      if (args[0] === 'version') {
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('24.0.0'))
          child.emit('close', 0)
        })
      }
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: spawnFn as any,
    })

    const first = executor.run({
      workspaceRoot: '/tmp/ws-a',
      command: ['python', '-c', 'print(1)'],
      timeoutMs: 5_000,
      maxOutputChars: 1024,
      networkMode: 'none',
    })

    await new Promise((resolve) => setImmediate(resolve))
    const runChild = children.find((_, index) => {
      const call = spawnFn.mock.calls[index]
      return Array.isArray(call?.[1]) && call[1][0] === 'run'
    })
    expect(runChild).toBeTruthy()

    await expect(
      executor.run({
        workspaceRoot: '/tmp/ws-b',
        command: ['python', '-c', 'print(2)'],
        timeoutMs: 5_000,
        maxOutputChars: 1024,
        networkMode: 'none',
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_RUN_QUEUE_TIMEOUT',
      statusCode: 503,
    } satisfies Partial<WorkspaceServiceError>)

    runChild!.emit('close', 0)
    await expect(first).resolves.toMatchObject({ exitCode: 0, timeout: false })
  })

  it('kills named container on run timeout', async () => {
    delete process.env.HOSTNAME
    const spawnCalls: string[][] = []
    const spawnFn = jest.fn((_cmd: string, args: string[]) => {
      spawnCalls.push(args)
      const child = createMockChild()
      if (args[0] === 'version') {
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('24.0.0'))
          child.emit('close', 0)
        })
      } else if (args[0] === 'kill' || args[0] === 'rm') {
        queueMicrotask(() => child.emit('close', 0))
      }
      // leave docker run hanging until timeout
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const executor = new DockerExecutor({
      workspaceConfig: {
        ...baseConfig(),
        maxConcurrentRuns: 2,
        runQueueTimeoutMs: 5_000,
      },
      spawnFn: spawnFn as any,
    })

    await expect(
      executor.run({
        workspaceRoot: '/tmp/ws-timeout',
        command: ['python', '-c', 'while True: pass'],
        timeoutMs: 30,
        maxOutputChars: 1024,
        networkMode: 'none',
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_EXEC_TIMEOUT',
      statusCode: 408,
    })

    const runArgs = spawnCalls.find((args) => args[0] === 'run')
    expect(runArgs).toBeTruthy()
    const nameIndex = runArgs!.indexOf('--name')
    expect(nameIndex).toBeGreaterThan(-1)
    const containerName = runArgs![nameIndex + 1]
    expect(containerName.startsWith(WORKSPACE_CONTAINER_NAME_PREFIX)).toBe(true)
    expect(runArgs).toEqual(expect.arrayContaining(['--memory-swap', '512m']))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawnCalls.some((args) => args[0] === 'kill' && args[1] === containerName)).toBe(true)
    expect(spawnCalls.some((args) => args[0] === 'rm' && args.includes(containerName))).toBe(true)
  })

  it('cleans orphan containers by name prefix', async () => {
    delete process.env.HOSTNAME
    const spawnFn = jest.fn((_cmd: string, args: string[]) => {
      const child = createMockChild()
      queueMicrotask(() => {
        if (args[0] === 'ps') {
          child.stdout.emit('data', Buffer.from('cid-1\ncid-2\n'))
        }
        child.emit('close', 0)
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: spawnFn as any,
    })

    await expect(executor.cleanupOrphanContainers()).resolves.toBe(2)
    const listed = spawnFn.mock.calls.some(
      (call) =>
        Array.isArray(call[1]) &&
        call[1][0] === 'ps' &&
        call[1].includes(`name=^/${WORKSPACE_CONTAINER_NAME_PREFIX}`),
    )
    expect(listed).toBe(true)
  })

  it('kills named container when abort signal fires', async () => {
    delete process.env.HOSTNAME
    const spawnCalls: string[][] = []
    const controller = new AbortController()
    const spawnFn = jest.fn((_cmd: string, args: string[]) => {
      spawnCalls.push(args)
      const child = createMockChild()
      if (args[0] === 'version') {
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from('24.0.0'))
          child.emit('close', 0)
        })
      } else if (args[0] === 'kill' || args[0] === 'rm') {
        queueMicrotask(() => child.emit('close', 0))
      } else if (args[0] === 'run') {
        queueMicrotask(() => controller.abort())
      }
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const executor = new DockerExecutor({
      workspaceConfig: {
        ...baseConfig(),
        maxConcurrentRuns: 2,
        runQueueTimeoutMs: 5_000,
      },
      spawnFn: spawnFn as any,
    })

    await expect(
      executor.run({
        workspaceRoot: '/tmp/ws-cancel',
        command: ['python', '-c', 'while True: pass'],
        timeoutMs: 5_000,
        maxOutputChars: 1024,
        networkMode: 'none',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_EXEC_CANCELLED',
      statusCode: 499,
    })

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawnCalls.some((args) => args[0] === 'kill')).toBe(true)
    expect(spawnCalls.some((args) => args[0] === 'rm')).toBe(true)
  })
})

describe('parseMountInfo', () => {
  it('returns [] for empty or invalid content', () => {
    expect(parseMountInfo('')).toEqual([])
    expect(parseMountInfo('not a mountinfo line')).toEqual([])
    expect(parseMountInfo('   ')).toEqual([])
  })

  it('parses bind/named-volume mounts and drops root/pseudo filesystems', () => {
    // 真实 mountinfo 格式：bind mount 的宿主源路径在第 4 字段（root），
    // 分隔符后第 2 字段是底层设备（如 /dev/vda2），不能作为宿主路径使用。
    const content = [
      '37 35 0:22 / / rw,relatime - overlay overlay rw',
      '38 37 0:24 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
      '39 37 0:25 / /sys rw,relatime - sysfs sysfs rw',
      '40 37 0:26 / /tmp rw,nosuid,nodev,noexec,relatime - tmpfs tmpfs rw',
      '563 37 253:2 /var/lib/docker/volumes/ai_chat_web_ui_db_data/_data /app/data rw,relatime - ext4 /dev/vda2 rw',
      '564 37 253:2 /var/lib/docker/volumes/ai_chat_web_ui_logs/_data /app/logs rw,relatime - ext4 /dev/vda2 rw',
      '565 37 253:2 /var/lib/docker/volumes/ai_chat_web_ui_images/_data /app/storage/chat-images rw,relatime - ext4 /dev/vda2 rw',
    ].join('\n')
    expect(parseMountInfo(content)).toEqual([
      { source: '/var/lib/docker/volumes/ai_chat_web_ui_db_data/_data', destination: '/app/data' },
      { source: '/var/lib/docker/volumes/ai_chat_web_ui_logs/_data', destination: '/app/logs' },
      {
        source: '/var/lib/docker/volumes/ai_chat_web_ui_images/_data',
        destination: '/app/storage/chat-images',
      },
    ])
  })

  it('decodes octal-escaped paths', () => {
    const content = [
      '101 37 253:2 /host/my\\040dir /data/my\\040dir rw,relatime - ext4 /dev/vda2 rw',
      '102 37 253:2 /srv/code\\134foo /opt/code\\134foo rw,relatime - ext4 /dev/vda2 rw',
    ].join('\n')
    expect(parseMountInfo(content)).toEqual([
      { source: '/host/my dir', destination: '/data/my dir' },
      { source: '/srv/code\\foo', destination: '/opt/code\\foo' },
    ])
  })
})

describe('workspace mount translation via /proc/self/mountinfo', () => {
  const originalHostname = process.env.HOSTNAME
  let mountInfoDir: string

  afterEach(() => {
    if (originalHostname === undefined) {
      delete process.env.HOSTNAME
    } else {
      process.env.HOSTNAME = originalHostname
    }
  })

  beforeAll(() => {
    mountInfoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aichat-mountinfo-'))
  })

  afterAll(() => {
    fs.rmSync(mountInfoDir, { recursive: true, force: true })
  })

  const writeMountInfo = (lines: string[]): string => {
    const filePath = path.join(mountInfoDir, `mountinfo-${Math.random().toString(36).slice(2)}`)
    fs.writeFileSync(filePath, lines.join('\n'), 'utf8')
    return filePath
  }

  const createSpawnRecorder = (spawnCalls: string[][]) =>
    jest.fn((_cmd: string, args: string[]) => {
      spawnCalls.push(args)
      const child = createMockChild()
      queueMicrotask(() => {
        if (args[0] === 'version') {
          child.stdout.emit('data', Buffer.from('24.0.0'))
        }
        child.emit('close', 0)
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })

  it('translates workspace root from mountinfo without docker self-inspect', async () => {
    const mountInfoPath = writeMountInfo([
      '37 35 0:22 / / rw,relatime - overlay overlay rw',
      '38 37 0:24 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw',
      '39 37 0:25 / /sys rw,relatime - sysfs sysfs rw',
      '563 37 253:2 /var/lib/docker/volumes/ai_chat_web_ui_db_data/_data /app/data rw,relatime - ext4 /dev/vda2 rw',
      '564 37 253:2 /var/lib/docker/volumes/ai_chat_web_ui_logs/_data /app/logs rw,relatime - ext4 /dev/vda2 rw',
    ])
    // HOSTNAME 与守护进程容器 ID 不一致（生产 docker-socket-proxy 场景），自检必然 404
    process.env.HOSTNAME = 'fd7a7f16bd65'
    const spawnCalls: string[][] = []
    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: createSpawnRecorder(spawnCalls) as any,
      mountInfoPath,
    })

    const result = await executor.run({
      workspaceRoot: '/app/data/workspaces/chat/23',
      command: ['python', '-c', 'print(1)'],
      timeoutMs: 5_000,
      maxOutputChars: 1024,
      networkMode: 'none',
    })

    expect(result.exitCode).toBe(0)
    const runArgs = spawnCalls.find((args) => args[0] === 'run')
    expect(runArgs).toBeTruthy()
    const volumeIndex = runArgs!.indexOf('--volume')
    expect(volumeIndex).toBeGreaterThan(-1)
    const volume = runArgs![volumeIndex + 1]
    const expectedSource = path.resolve(
      '/var/lib/docker/volumes/ai_chat_web_ui_db_data/_data',
      'workspaces/chat/23',
    )
    expect(volume).toBe(`${expectedSource}:/workspace`)
    // 不再依赖 docker inspect 容器自检
    expect(spawnCalls.some((args) => args[0] === 'inspect')).toBe(false)
  })

  it('skips translation when mountinfo only exposes the root mount (bare host)', async () => {
    const mountInfoPath = writeMountInfo(['20 0 8:2 / / rw,relatime - ext4 /dev/sda1 rw'])
    delete process.env.HOSTNAME
    const spawnCalls: string[][] = []
    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: createSpawnRecorder(spawnCalls) as any,
      mountInfoPath,
    })

    const result = await executor.run({
      workspaceRoot: '/app/data/workspaces/chat/23',
      command: ['python', '-c', 'print(1)'],
      timeoutMs: 5_000,
      maxOutputChars: 1024,
      networkMode: 'none',
    })

    expect(result.exitCode).toBe(0)
    const runArgs = spawnCalls.find((args) => args[0] === 'run')
    expect(runArgs).toBeTruthy()
    const volumeIndex = runArgs!.indexOf('--volume')
    expect(volumeIndex).toBeGreaterThan(-1)
    const volume = runArgs![volumeIndex + 1]
    expect(volume).toBe(`${path.resolve('/app/data/workspaces/chat/23')}:/workspace`)
    expect(spawnCalls.some((args) => args[0] === 'inspect')).toBe(false)
  })

  it('falls back to docker inspect when mountinfo resolves no mounts', async () => {
    const mountInfoPath = writeMountInfo([''])
    const hostname = 'fd7a7f16bd65'
    process.env.HOSTNAME = hostname
    const spawnCalls: string[][] = []
    const spawnFn = jest.fn((_cmd: string, args: string[]) => {
      spawnCalls.push(args)
      const child = createMockChild()
      queueMicrotask(() => {
        if (args[0] === 'version') {
          child.stdout.emit('data', Buffer.from('24.0.0'))
        } else if (args[0] === 'inspect') {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify([
                {
                  Source: '/var/lib/docker/volumes/ai_chat_web_ui_db_data/_data',
                  Destination: '/app/data',
                },
              ]),
            ),
          )
        }
        child.emit('close', 0)
      })
      return child as unknown as ChildProcessWithoutNullStreams
    })

    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: spawnFn as any,
      mountInfoPath,
    })

    const result = await executor.run({
      workspaceRoot: '/app/data/workspaces/chat/23',
      command: ['python', '-c', 'print(1)'],
      timeoutMs: 5_000,
      maxOutputChars: 1024,
      networkMode: 'none',
    })

    expect(result.exitCode).toBe(0)
    // 回退路径确实调用了 docker inspect 容器自检
    const inspectArgs = spawnCalls.find((args) => args[0] === 'inspect')
    expect(inspectArgs).toBeTruthy()
    expect(inspectArgs).toContain(hostname)

    const runArgs = spawnCalls.find((args) => args[0] === 'run')
    expect(runArgs).toBeTruthy()
    const volumeIndex = runArgs!.indexOf('--volume')
    expect(volumeIndex).toBeGreaterThan(-1)
    const volume = runArgs![volumeIndex + 1]
    const expectedSource = path.resolve(
      '/var/lib/docker/volumes/ai_chat_web_ui_db_data/_data',
      'workspaces/chat/23',
    )
    expect(volume).toBe(`${expectedSource}:/workspace`)
  })

  it('logs a warning when mountinfo cannot be read', async () => {
    // 注入不存在的 mountinfo 路径，readFileSync 将抛 ENOENT
    const mountInfoPath = path.join(mountInfoDir, 'does-not-exist')
    delete process.env.HOSTNAME
    const spawnCalls: string[][] = []
    const executor = new DockerExecutor({
      workspaceConfig: baseConfig(),
      spawnFn: createSpawnRecorder(spawnCalls) as any,
      mountInfoPath,
    })

    const warnSpy = jest.spyOn(log, 'warn')
    try {
      const result = await executor.run({
        workspaceRoot: '/app/data/workspaces/chat/23',
        command: ['python', '-c', 'print(1)'],
        timeoutMs: 5_000,
        maxOutputChars: 1024,
        networkMode: 'none',
      })

      expect(result.exitCode).toBe(0)
      // 读取失败且 HOSTNAME 为空，直接短路回退，不应触发 docker inspect 自检
      expect(spawnCalls.some((args) => args[0] === 'inspect')).toBe(false)
      // 警告日志应包含失败的 mountinfo 路径，便于诊断
      expect(
        warnSpy.mock.calls.some(
          (call) => (call[1] as Record<string, unknown> | undefined)?.mountInfoPath === mountInfoPath,
        ),
      ).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })
})
