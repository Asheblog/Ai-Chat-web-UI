import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import readline from 'node:readline'

export interface TraceEvent {
  id: string
  seq: number
  eventType: string
  payload: any
  timestamp: string | null
}

export interface LatexEvent {
  seq: number
  matched: boolean
  reason: string
  raw: string
  normalized: string
  trimmed: string
}

export class TaskTraceFileService {
  async readTraceEventsFromFile(
    filePath: string | null | undefined,
    limit = 2000,
  ): Promise<{ events: TraceEvent[]; truncated: boolean }> {
    const events: TraceEvent[] = []
    if (!filePath) {
      return { events, truncated: false }
    }
    try {
      await access(filePath)
    } catch {
      return { events, truncated: false }
    }
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let truncated = false
    const take = Math.max(1, limit)
    const maxLines = take + 1
    try {
      for await (const line of rl) {
        if (!line.trim()) continue
        let parsed: any = null
        try {
          parsed = JSON.parse(line)
        } catch {
          continue
        }
        const seq = typeof parsed.seq === 'number' ? parsed.seq : events.length + 1
        const eventType = typeof parsed.eventType === 'string' ? parsed.eventType : (parsed.type || 'event')
        events.push({
          id: `${seq}`,
          seq,
          eventType,
          payload: parsed.payload ?? {},
          timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
        })
        if (events.length >= maxLines) {
          truncated = true
          events.pop()
          break
        }
      }
    } finally {
      rl.close()
      stream.destroy()
    }
    return { events, truncated }
  }

  async readLatexEventsFromFile(
    filePath: string | null | undefined,
    limit = 2000,
  ): Promise<{ events: LatexEvent[]; truncated: boolean }> {
    const items: LatexEvent[] = []
    if (!filePath) {
      return { events: items, truncated: false }
    }
    try {
      await access(filePath)
    } catch {
      return { events: items, truncated: false }
    }
    const stream = createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
    let truncated = false
    const maxLines = Math.max(1, limit)
    try {
      for await (const line of rl) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          items.push({
            seq: typeof parsed.seq === 'number' ? parsed.seq : items.length + 1,
            matched: Boolean(parsed.matched),
            reason: typeof parsed.reason === 'string' ? parsed.reason : '',
            raw: typeof parsed.raw === 'string' ? parsed.raw : '',
            normalized: typeof parsed.normalized === 'string' ? parsed.normalized : '',
            trimmed: typeof parsed.trimmed === 'string' ? parsed.trimmed : '',
          })
        } catch {
          continue
        }
        if (items.length >= maxLines) {
          truncated = true
          break
        }
      }
    } finally {
      rl.close()
      stream.destroy()
    }
    return { events: items, truncated }
  }
}

let taskTraceFileService = new TaskTraceFileService()

export const setTaskTraceFileService = (service: TaskTraceFileService) => {
  taskTraceFileService = service
}

export { taskTraceFileService }
