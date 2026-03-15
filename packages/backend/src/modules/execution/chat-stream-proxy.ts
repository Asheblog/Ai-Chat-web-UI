import { createChatExecutionEventBridge } from './chat-execution-event-bridge'
import type { ExecutionSseEvent } from '@aichat/shared/execution-contract'

export interface ProxyChatStreamToExecutionOptions {
  legacyResponse: Response
  sessionId: number
  runKey: string
  sourceId?: string
  onEvent?: (event: ExecutionSseEvent) => void | Promise<void>
}

const tryParseJson = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

const pushSsePayload = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: { encode: (value?: string) => Uint8Array },
  payload: unknown,
) => {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
}

export const proxyChatStreamToExecution = (
  options: ProxyChatStreamToExecutionOptions,
): Response => {
  const { legacyResponse, sessionId, runKey, sourceId, onEvent } = options

  const contentType = legacyResponse.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    return legacyResponse
  }

  if (!legacyResponse.body) {
    return legacyResponse
  }

  const bridge = createChatExecutionEventBridge({
    runKey,
    sessionId,
    sourceId,
  })

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = legacyResponse.body.getReader()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = ''
      let terminalEmitted = false

      const emitEvents = async (events: ExecutionSseEvent[]) => {
        for (const event of events) {
          if (event.type === 'complete') {
            terminalEmitted = true
          }
          pushSsePayload(controller, encoder, event)
          if (onEvent) {
            await onEvent(event)
          }
        }
      }

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (value) {
            buffer += decoder.decode(value, { stream: true })
            while (true) {
              const newlineIndex = buffer.indexOf('\n')
              if (newlineIndex === -1) break
              const rawLine = buffer.slice(0, newlineIndex)
              buffer = buffer.slice(newlineIndex + 1)
              const line = rawLine.replace(/\r$/, '')
              if (!line || line.startsWith(':')) continue
              if (!line.startsWith('data:')) continue
              const payloadRaw = line.slice(5).trimStart()
              if (!payloadRaw) continue
              if (payloadRaw === '[DONE]') {
                terminalEmitted = true
                continue
              }
              const parsed = tryParseJson(payloadRaw)
              if (!parsed) continue
              const events = bridge.consume(parsed)
              await emitEvents(events)
            }
          }
          if (done) {
            break
          }
        }

        if (!terminalEmitted) {
          const fallbackEvents = bridge.consume({ type: 'complete' })
          await emitEvents(fallbackEvents)
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (error) {
        try {
          const events = bridge.consume({
            type: 'error',
            error: error instanceof Error ? error.message : 'Stream proxy failed',
          })
          await emitEvents(events)
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch {
          controller.error(error)
        }
      } finally {
        reader.releaseLock()
      }
    },
  })

  const headers = new Headers(legacyResponse.headers)
  headers.set('Content-Type', 'text/event-stream; charset=utf-8')
  headers.set('Cache-Control', 'no-cache, no-transform')
  headers.set('Connection', 'keep-alive')
  headers.set('X-Accel-Buffering', 'no')

  return new Response(stream, {
    status: legacyResponse.status,
    statusText: legacyResponse.statusText,
    headers,
  })
}
