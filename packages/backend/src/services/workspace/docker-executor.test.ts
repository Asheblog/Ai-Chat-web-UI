import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { DockerExecutor, WORKSPACE_CONTAINER_NAME_PREFIX } from './docker-executor'
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
})
