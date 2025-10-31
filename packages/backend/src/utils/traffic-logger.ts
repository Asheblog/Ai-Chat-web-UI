import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { BackendLogger as log } from './logger'

const LOG_PATH = process.env.TRAFFIC_LOG_PATH || './tmp/traffic.log'

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

