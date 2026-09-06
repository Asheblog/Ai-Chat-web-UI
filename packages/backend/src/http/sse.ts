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
  /** 所有关闭路径完成清理后解决；订阅型生产者须等待此信号。 */
  readonly closed: Promise<void>
  /** 注册幂等关闭清理；已关闭时立即执行。 */
  onClose(cleanup: () => void): void
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
  let disconnect = () => {}
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()
      let downstreamClosed = false
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null
      const cleanups = new Set<() => void>()
      let resolveClosed!: () => void
      const closed = new Promise<void>((resolve) => { resolveClosed = resolve })

      const clean = (cleanup: () => void) => {
        try { cleanup() } catch { /* Continue releasing other resources. */ }
      }

      const finish = (sendDone: boolean) => {
        if (downstreamClosed) return
        downstreamClosed = true
        ctx.stopHeartbeat()
        options.signal?.removeEventListener('abort', disconnect)
        for (const cleanup of cleanups) clean(cleanup)
        cleanups.clear()
        if (sendDone) {
          try {
            controller.enqueue(encoder.encode(options.donePayload ?? 'data: [DONE]\n\n'))
          } catch { /* The reader may already have cancelled. */ }
        }
        try { controller.close() } catch { /* Already cancelled downstream. */ }
        resolveClosed()
      }

      const enqueue = (payload: string): boolean => {
        if (downstreamClosed) return false
        try {
          controller.enqueue(encoder.encode(payload))
          return true
        } catch {
          disconnect()
          return false
        }
      }

      const ctx: SseStreamContext = {
        send: (event) => enqueue(`data: ${JSON.stringify(event)}\n\n`),
        sendRaw: enqueue,
        isClosed: () => downstreamClosed,
        closed,
        onClose: (cleanup) => {
          if (downstreamClosed) clean(cleanup)
          else cleanups.add(cleanup)
        },
        startHeartbeat: (intervalMs, payload = ': ping\n\n') => {
          if (downstreamClosed || heartbeatTimer !== null || intervalMs <= 0) return
          heartbeatTimer = setInterval(() => {
            const next = typeof payload === 'function' ? payload() : payload
            enqueue(next)
          }, intervalMs)
        },
        stopHeartbeat: () => {
          if (heartbeatTimer !== null) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
          }
        },
        close: () => finish(true),
      }

      disconnect = () => {
        if (downstreamClosed) return
        finish(false)
        clean(() => options.onAbort?.(ctx))
      }

      if (options.signal) {
        if (options.signal.aborted) {
          disconnect()
        } else {
          options.signal.addEventListener('abort', disconnect, { once: true })
        }
      }

      // Do not return the producer promise: cancellation must not wait for background work.
      const execute = async () => {
        try {
          if (!ctx.isClosed()) await run(ctx)
        } catch (error) {
          clean(() => options.onError?.(error, ctx))
        } finally {
          ctx.close()
        }
      }
      void execute()
    },
    cancel: () => disconnect(),
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
