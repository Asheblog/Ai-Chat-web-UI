import { describe, expect, it } from 'vitest'
import { parseEventStream } from '../stream-reader'

function mockResponse(body: string): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** 创建一个在 enqueue 后不 close 的 Response */
function createOpenStream(): { response: Response; enqueue: (text: string) => void } {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController | null = null
  const stream = new ReadableStream({
    start(c) { controller = c },
    cancel() { controller = null },
  })
  return {
    response: new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
    enqueue(text: string) { controller?.enqueue(encoder.encode(text)) },
  }
}

async function collectStream(response: Response): Promise<{ chunks: any[]; error?: any }> {
  const chunks: any[] = []
  try {
    for await (const chunk of parseEventStream(response, 'test-key', () => {})) {
      chunks.push(chunk)
    }
    return { chunks }
  } catch (error) {
    return { chunks, error }
  }
}

describe('parseEventStream legacy type:error termination', () => {
  it('does not throw STREAM_INCOMPLETE after legacy type:error event', async () => {
    const response = mockResponse(
      'data: {"type":"error","error":"测试错误","errorType":"api_error","suggestion":"请重试"}\n\n',
    )

    const { chunks, error } = await collectStream(response)

    // Should have yielded the error chunk
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ type: 'error', error: '测试错误' })

    // Should NOT throw STREAM_INCOMPLETE
    expect(error).toBeUndefined()
  })

  it('still throws STREAM_INCOMPLETE when stream ends without terminal event', async () => {
    const response = mockResponse(
      'data: {"type":"content","content":"hello"}\n\n',
    )

    const { chunks, error } = await collectStream(response)

    expect(chunks).toHaveLength(1)
    expect(error).toBeDefined()
    expect(error?.code).toBe('STREAM_INCOMPLETE')
  })

  it('stops iterating after error event even if stream does not close', async () => {
    const { response, enqueue } = createOpenStream()
    enqueue('data: {"type":"error","error":"致命错误"}\n\n')

    const result = await collectStream(response)

    // Must yield the error chunk
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]).toMatchObject({ type: 'error', error: '致命错误' })
    // Must NOT throw STREAM_INCOMPLETE — termination was clean
    expect(result.error).toBeUndefined()
  })
})
