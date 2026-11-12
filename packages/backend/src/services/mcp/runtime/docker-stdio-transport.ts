import { randomUUID } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import type { McpTransport } from './transport'

export class McpGatewayError extends Error {
  code: string
  constructor(message: string, code = 'MCP_GATEWAY_ERROR') {
    super(message)
    this.name = 'McpGatewayError'
    this.code = code
  }
}

export interface GatewayTarget {
  image: string
  command: string[]
}

const NODE_IMAGE = () => (process.env.MCP_GATEWAY_NODE_IMAGE || 'node:20-slim').trim()
const PYTHON_IMAGE = () =>
  (process.env.MCP_GATEWAY_PYTHON_IMAGE || 'ghcr.io/astral-sh/uv:python3.12-bookworm-slim').trim()

/**
 * 把清单里的启动方式翻译成容器内命令。
 * 本地包一律在容器里跑（ADR-0015），宿主机不直接执行第三方代码。
 */
export function resolveGatewayTarget(command: string, args: string[]): GatewayTarget {
  const cmd = (command || '').trim()
  if (!cmd) throw new McpGatewayError('本地包型 MCP 缺少启动命令', 'MCP_GATEWAY_INVALID_COMMAND')

  if (cmd === 'npx' || cmd === 'node' || cmd === 'pnpm') {
    return { image: NODE_IMAGE(), command: [cmd, ...args] }
  }
  if (cmd === 'uvx' || cmd === 'uv' || cmd === 'python' || cmd === 'python3') {
    return { image: PYTHON_IMAGE(), command: [cmd, ...args] }
  }
  if (cmd === 'docker') {
    const image = args.find((item) => !item.startsWith('-') && item !== 'run' && item !== 'rm')
    if (!image) throw new McpGatewayError('docker 启动方式缺少镜像名', 'MCP_GATEWAY_INVALID_COMMAND')
    return { image, command: [] }
  }
  // 只接受镜像引用（registry/namespace/name[:tag]）；宿主路径（/bin/sh、./x）一律拒绝，
  // 否则等价于把宿主机命令透传给容器
  const IMAGE_REF = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9._-]+)?\/[a-z0-9][a-z0-9._/-]*(?::[a-z0-9._-]+)?$/i
  if (IMAGE_REF.test(cmd) && !cmd.includes('..')) {
    return { image: cmd, command: args }
  }
  throw new McpGatewayError(`暂不支持的本地启动命令：${cmd}`, 'MCP_GATEWAY_UNSUPPORTED_COMMAND')
}

/**
 * 通过 `docker run -i` 承载 stdio MCP 服务：stdin/stdout 就是 JSON-RPC 管道。
 * 容器受限：cap-drop、no-new-privileges、pids/cpu/mem 限额。
 */
export class DockerStdioTransport implements McpTransport {
  private readonly containerName = `aichat-mcp-${randomUUID().slice(0, 8)}`
  private child: ReturnType<typeof spawn> | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private messageHandler: ((payload: string) => void) | null = null
  private errorHandler: ((error: Error) => void) | null = null
  private closeHandler: (() => void) | null = null
  private closed = false

  constructor(
    private readonly target: GatewayTarget,
    private readonly env: Record<string, string> = {},
  ) {}

  async start(): Promise<void> {
    const args = [
      'run',
      '-i',
      '--rm',
      '--name',
      this.containerName,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--pids-limit',
      process.env.MCP_GATEWAY_PIDS_LIMIT || '128',
      '--cpus',
      process.env.MCP_GATEWAY_CPUS || '0.5',
      '-m',
      process.env.MCP_GATEWAY_MEMORY || '512m',
      '--tmpfs',
      '/tmp',
      '--network',
      process.env.MCP_GATEWAY_NETWORK || 'bridge',
    ]
    for (const [key, value] of Object.entries(this.env)) {
      args.push('-e', `${key}=${value}`)
    }
    args.push(this.target.image, ...this.target.command)

    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child

    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        reject(error)
      }
      child.once('error', (error: any) => {
        if (error?.code === 'ENOENT') {
          fail(new McpGatewayError('宿主机未安装 docker CLI，无法启动本地包型 MCP', 'MCP_GATEWAY_UNAVAILABLE'))
          return
        }
        fail(new McpGatewayError(`启动容器失败：${error?.message ?? 'unknown'}`))
      })
      child.once('spawn', () => {
        if (settled) return
        settled = true
        resolve()
      })
    })

    child.stdout?.on('data', (chunk: Buffer) => this.consumeStdout(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-4000)
    })
    child.on('close', (code) => {
      if (this.closed) return
      this.closed = true
      const detail = this.stderrTail.trim().split('\n').slice(-4).join(' | ')
      this.errorHandler?.(
        new McpGatewayError(
          `MCP 容器已退出（code=${code ?? 'null'}）${detail ? `：${detail}` : ''}`,
          'MCP_GATEWAY_EXITED',
        ),
      )
      this.closeHandler?.()
    })
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let index = this.stdoutBuffer.indexOf('\n')
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1)
      if (line) this.messageHandler?.(line)
      index = this.stdoutBuffer.indexOf('\n')
    }
  }

  async send(payload: string): Promise<void> {
    if (!this.child || this.closed) throw new McpGatewayError('MCP 容器未运行', 'MCP_GATEWAY_EXITED')
    this.child.stdin?.write(`${payload}\n`)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try {
      this.child?.kill('SIGTERM')
    } catch {
      // 忽略
    }
    execFile('docker', ['rm', '-f', this.containerName], () => undefined)
  }

  onMessage(handler: (payload: string) => void): void { this.messageHandler = handler }
  onError(handler: (error: Error) => void): void { this.errorHandler = handler }
  onClose(handler: () => void): void { this.closeHandler = handler }
}
