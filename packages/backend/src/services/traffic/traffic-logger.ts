import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { BackendLogger as log } from '../../utils/logger'

export interface TrafficLogEntry {
  category: 'client-request' | 'client-response' | 'upstream-request' | 'upstream-response' | 'upstream-error'
  route: string
  direction: 'inbound' | 'outbound'
  context?: Record<string, any>
  payload?: unknown
}

export interface TrafficLoggerDeps {
  append?: typeof appendFile
  mkdir?: typeof mkdir
  resolvePath?: () => string
  now?: () => Date
  logger?: Pick<typeof log, 'error'>
}

export class TrafficLogger {
  private append: typeof appendFile
  private mkdir: typeof mkdir
  private resolvePath: () => string
  private now: () => Date
  private logger: Pick<typeof log, 'error'>
  private ensured = false
  private logPath: string

  constructor(deps: TrafficLoggerDeps = {}) {
    this.append = deps.append ?? appendFile
    this.mkdir = deps.mkdir ?? mkdir
    this.resolvePath = deps.resolvePath ?? resolveLogPath
    this.now = deps.now ?? (() => new Date())
    this.logger = deps.logger ?? log
    this.logPath = this.resolvePath()
  }

  async log(entry: TrafficLogEntry) {
    try {
      await this.ensureDir()
      const record = {
        timestamp: this.now().toISOString(),
        ...entry,
      }
      await this.append(this.logPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8' })
    } catch (error) {
      this.logger.error?.('[traffic] log failed', error)
    }
  }

  private async ensureDir() {
    if (this.ensured) return
    try {
      await this.mkdir(dirname(this.logPath), { recursive: true })
      this.ensured = true
    } catch (error) {
      this.logger.error?.('[traffic] ensureDir failed', error)
    }
  }
}

const resolveLogPath = () => {
  const explicit = process.env.TRAFFIC_LOG_PATH
  if (explicit) return resolve(explicit)

  const dirFromEnv = process.env.TRAFFIC_LOG_DIR || process.env.LOG_DIR
  if (dirFromEnv) return resolve(dirFromEnv, 'traffic.log')

  // 默认写入 logs 目录，确保容器内使用已赋权的 /app/logs
  return resolve(process.cwd(), 'logs', 'traffic.log')
}

export const trafficLogger = new TrafficLogger()
