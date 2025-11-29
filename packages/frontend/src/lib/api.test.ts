import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './api'
import type { ChatStreamChunk } from '@/types'

const encoder = new TextEncoder()

const createSseStream = (lines: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line))
      }
      controller.close()
    },
  })

describe('ApiClient.streamChat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('透传 start 事件中的真实消息 ID，避免客户端重复消息', async () => {
    const stream = createSseStream([
      'data: {"type":"start","message_id":301,"assistant_message_id":302,"assistant_client_message_id":"assistant-302"}\n\n',
      'data: {"type":"complete"}\n\n',
    ])
    const mockResponse = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValue(mockResponse as Response)

    const emitted: ChatStreamChunk[] = []

    for await (const chunk of apiClient.streamChat(1, 'hello world')) {
      emitted.push(chunk)
    }

    const startChunk = emitted.find((chunk) => chunk.type === 'start')
    expect(startChunk).toBeTruthy()
    expect(startChunk?.messageId).toBe(301)
    expect(startChunk?.assistantMessageId).toBe(302)
    expect(startChunk?.assistantClientMessageId).toBe('assistant-302')
  })
})
