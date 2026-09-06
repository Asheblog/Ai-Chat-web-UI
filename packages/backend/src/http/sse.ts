/**
 * 后端 SSE 响应公共工具。
 *
 * 收敛 api/battle.ts、api/shares.ts、api/openai-compatible.ts、
 * modules/chat/use-cases/chat-stream-use-case.ts 中重复的
 * headers + ReadableStream + heartbeat + abort + [DONE] 样板。
 */

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Cache-Control',
}

export interface SseStreamContext {
  /** 发送一个 JSON 事件（自动包装为 `data: {...}\n\n`）。 */
  send(event: unknown): boolean
  /** 发送原始 SSE 文本（如 `: ping\n\n`）。 */
  sendRaw(payload: string): boolean
  isClosed(): boolean
  /** 标记下游已关闭，后续 send 不再投递。 */
  markClosed(reason?: string): void
  /** 启动心跳；payload 为字符串或返回字符串的函数。 */
  startHeartbeat(intervalMs: number, payload?: string | (() => string)): void
  stopHeartbeat(): void
  /** 发送终止标记并关闭流（幂等）。 */
  close(): void
}

export interface CreateSseResponseOptions {
  signal?: AbortSignal
  onAbort?: (ctx: SseStreamContext) => void
  onError?: (error: unknown, ctx: SseStreamContext) => void
  /** 终止标记，默认 `data: [DONE]\n\n`。 */
  donePayload?: string
}

export const createSseResponse = (
  run: (ctx: SseStreamContext) => Promise<void> | void,
  options: CreateSseResponseOptions = {},
): Response => {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let downstreamClosed = false
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null

      const enqueue = (payload: string): boolean => {
        if (downstreamClosed) return false
        try {
          controller.enqueue(encoder.encode(payload))
          return true
        } catch {
          downstreamClosed = true
          return false
        }
      }

      const ctx: SseStreamContext = {
        send: (event) => enqueue(`data: ${JSON.stringify(event)}\n\n`),
        sendRaw: enqueue,
        isClosed: () => downstreamClosed,
        markClosed: () => {
          downstreamClosed = true
        },
        startHeartbeat: (intervalMs, payload = ': ping\n\n') => {
          if (heartbeatTimer || intervalMs <= 0) return
          heartbeatTimer = setInterval(() => {
            const next = typeof payload === 'function' ? payload() : payload
            enqueue(next)
          }, intervalMs)
        },
        stopHeartbeat: () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
          }
        },
        close: () => {
          if (downstreamClosed) return
          downstreamClosed = true
          ctx.stopHeartbeat()
          try {
            controller.enqueue(encoder.encode(options.donePayload ?? 'data: [DONE]\n\n'))
          } catch {
            // ignore
          }
          try {
            controller.close()
          } catch {
            // ignore
          }
        },
      }

      const handleAbort = () => {
        try {
          options.onAbort?.(ctx)
        } catch {
          // ignore
        }
      }

      if (options.signal) {
        if (options.signal.aborted) {
          handleAbort()
        } else {
          options.signal.addEventListener('abort', handleAbort, { once: true })
        }
      }

      try {
        await run(ctx)
      } catch (error) {
        try {
          options.onError?.(error, ctx)
        } catch {
          // ignore
        }
      } finally {
        if (options.signal) {
          try {
            options.signal.removeEventListener('abort', handleAbort)
          } catch {
            // ignore
          }
        }
        ctx.close()
      }
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
