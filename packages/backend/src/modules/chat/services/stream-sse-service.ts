import type { TaskTraceRecorder } from '../../../utils/task-trace'
import { summarizeSseLine } from '../../../utils/task-trace'

export interface StreamLogBase {
  sessionId?: number
  actor?: string
  clientMessageId?: string | null
  assistantMessageId?: number | null
}

export interface StreamEmitterParams {
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  requestSignal: AbortSignal
  traceRecorder: TaskTraceRecorder
  streamLogBase: () => StreamLogBase
}

export interface StreamEmitter {
  enqueue(payload: string): boolean
  markClosed(reason?: string, meta?: Record<string, unknown>): void
  isClosed(): boolean
}

export interface HeartbeatOptions {
  emitter: StreamEmitter
  heartbeatIntervalMs: number
  providerInitialGraceMs: number
  providerReasoningIdleMs: number
  reasoningKeepaliveIntervalMs: number
  streamKeepaliveIntervalMs: number
  traceIdleTimeoutMs: number | null
  getTimestamps: () => {
    firstChunkAt: number | null
    lastChunkAt: number | null
    lastKeepaliveSentAt: number
    requestStartedAt: number
  }
  setLastKeepaliveSentAt: (ts: number) => void
  onTraceIdleTimeout?: (idleMs: number) => void
  cancelProvider?: () => void
  flushReasoningDelta: (force: boolean) => Promise<void>
  flushVisibleDelta: (force: boolean) => Promise<void>
  emitReasoningKeepalive: (idleMs: number) => void
  emitStreamKeepalive: (idleMs: number) => void
}

export class StreamSseService {
  createEmitter(params: StreamEmitterParams): StreamEmitter {
    let downstreamClosed = false
    const markClosed = (reason?: string, meta?: Record<string, unknown>) => {
      if (downstreamClosed) return
      downstreamClosed = true
      const payload = {
        ...params.streamLogBase(),
        reason: reason ?? 'unknown',
        ...(meta ?? {}),
      }
      params.traceRecorder.log('stream:downstream_closed', payload)
    }

    const enqueue = (payload: string): boolean => {
      if (!downstreamClosed && params.requestSignal?.aborted) {
        markClosed('request-signal-aborted')
      }

      let delivered = false
      if (!downstreamClosed) {
        try {
          params.controller.enqueue(params.encoder.encode(payload))
          delivered = true
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err)
          markClosed('enqueue-error', { error: errorMessage })
        }
      }

      const summary = summarizeSseLine(payload.trim())
      if (summary) {
        params.traceRecorder.log('sse:dispatch', {
          ...summary,
          delivered,
          downstreamClosed,
        })
      }
      return delivered
    }

    return {
      enqueue,
      markClosed,
      isClosed: () => downstreamClosed,
    }
  }

  startHeartbeat(opts: HeartbeatOptions): () => void {
    const hb = setInterval(() => {
      try {
        opts.emitter.enqueue(': ping\n\n')
      } catch {}
      const now = Date.now()
      const { firstChunkAt, lastChunkAt, lastKeepaliveSentAt, requestStartedAt } =
        opts.getTimestamps()
      if (!firstChunkAt) {
        if (opts.providerInitialGraceMs > 0 && now - requestStartedAt > opts.providerInitialGraceMs) {
          try {
            opts.cancelProvider?.()
          } catch {}
        }
        return
      }
      const last = lastChunkAt ?? firstChunkAt
      const idleMs = now - last
      if (opts.traceIdleTimeoutMs && idleMs > opts.traceIdleTimeoutMs) {
        opts.onTraceIdleTimeout?.(idleMs)
      }
      if (opts.providerReasoningIdleMs > 0 && idleMs > opts.providerReasoningIdleMs) {
        try {
          opts.cancelProvider?.()
        } catch {}
        return
      }
      if (
        opts.reasoningKeepaliveIntervalMs > 0 &&
        idleMs > opts.reasoningKeepaliveIntervalMs &&
        now - lastKeepaliveSentAt > opts.reasoningKeepaliveIntervalMs
      ) {
        try {
          void opts.flushReasoningDelta(true).catch(() => {})
          void opts.flushVisibleDelta(true).catch(() => {})
          opts.emitReasoningKeepalive(idleMs)
          opts.setLastKeepaliveSentAt(now)
        } catch {}
      } else if (
        opts.streamKeepaliveIntervalMs > 0 &&
        idleMs > opts.streamKeepaliveIntervalMs &&
        now - lastKeepaliveSentAt > opts.streamKeepaliveIntervalMs
      ) {
        try {
          opts.emitStreamKeepalive(idleMs)
          opts.setLastKeepaliveSentAt(now)
        } catch {}
      }
    }, Math.max(1000, opts.heartbeatIntervalMs))

    return () => clearInterval(hb)
  }
}

let streamSseService = new StreamSseService()

export const setStreamSseService = (service: StreamSseService) => {
  streamSseService = service
}

export { streamSseService }
