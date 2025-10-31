import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { BackendLogger as log } from './logger'

const resolveLogPath = () => {
  const explicit = process.env.TRAFFIC_LOG_PATH
  if (explicit) return resolve(explicit)

  const dirFromEnv = process.env.TRAFFIC_LOG_DIR || process.env.LOG_DIR
  if (dirFromEnv) return resolve(dirFromEnv, 'traffic.log')

  // 默认写入 logs 目录，确保容器内使用已赋权的 /app/logs
  return resolve(process.cwd(), 'logs', 'traffic.log')
}

const LOG_PATH = resolveLogPath()

let ensured = false

const ensureDir = async () => {
  if (ensured) return
  try {
    await mkdir(dirname(LOG_PATH), { recursive: true })
  } catch (error) {
    log.error('[traffic] ensureDir failed', error)
  }
  ensured = true
}

export interface TrafficLogEntry {
  category: 'client-request' | 'client-response' | 'upstream-request' | 'upstream-response' | 'upstream-error'
  route: string
  direction: 'inbound' | 'outbound'
  context?: Record<string, any>
  payload?: unknown
}

export const logTraffic = async (entry: TrafficLogEntry) => {
  try {
    await ensureDir()
    const record = {
      timestamp: new Date().toISOString(),
      ...entry,
    }
    await appendFile(LOG_PATH, `${JSON.stringify(record)}\n`, { encoding: 'utf8' })
  } catch (error) {
    log.error('[traffic] log failed', error)
  }
}
