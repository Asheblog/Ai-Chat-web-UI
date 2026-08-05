import { StreamEventEmitter } from '../stream-event-emitter'

const decoder = new TextDecoder()

const createEmitter = () => {
  const chunks: string[] = []
  const controller = {
    enqueue: jest.fn((payload: Uint8Array) => {
      chunks.push(decoder.decode(payload))
    }),
    close: jest.fn(),
  } as unknown as ReadableStreamDefaultController<Uint8Array>

  const traceRecorder = {
    log: jest.fn(),
  } as any

  const emitter = new StreamEventEmitter({
    encoder: new TextEncoder(),
    controller,
    traceRecorder,
  })

  return { emitter, chunks, controller, traceRecorder }
}

describe('stream-event-emitter reasoning deltas', () => {
  test('preserves newline-only reasoning delta', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitReasoning('\n', { kind: 'model', stage: 'stream' })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('"type":"reasoning"')
    expect(chunks[0]).toContain('"content":"\\n"')
    expect(emitter.getReasoningBuffer()).toBe('\n')
  })

  test('preserves leading whitespace in reasoning delta', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitReasoning('  step-1')

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('"content":"  step-1"')
    expect(emitter.getReasoningBuffer()).toBe('  step-1')
  })

  test('kind=tool 的 emitReasoning 不入 buffer 也不发 SSE', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitReasoning('model thought', { kind: 'model', stage: 'stream' })
    emitter.emitReasoning('联网搜索：今日新闻', { kind: 'tool', tool: 'web_search' })
    emitter.emitReasoning('more model', { kind: 'model' })

    expect(emitter.getReasoningBuffer()).toBe('model thoughtmore model')
    expect(chunks).toHaveLength(2)
    expect(chunks.join('')).not.toContain('联网搜索')
  })

  test('emitToolEvent start 写入 reasoningOffsetStart', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitReasoning('before tool', { kind: 'model', stage: 'stream' })
    emitter.emitToolEvent({
      id: 'call-1',
      tool: 'web_search',
      stage: 'start',
      query: 'test',
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toContain('"reasoningOffsetStart":11')
    expect(chunks[1]).not.toContain('"reasoningOffsetEnd"')
  })

  test('emitToolEvent result 写入 reasoningOffsetEnd', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitReasoning('start reasoning', { kind: 'model', stage: 'stream' })
    emitter.emitToolEvent({ id: 'call-1', tool: 'web_search', stage: 'start' })
    emitter.emitReasoning(' after tool', { kind: 'model', stage: 'stream' })
    emitter.emitToolEvent({
      id: 'call-1',
      tool: 'web_search',
      stage: 'result',
      summary: 'done',
    })

    expect(chunks).toHaveLength(4)
    expect(chunks[1]).toContain('"reasoningOffsetStart":15')
    const resultChunk = chunks[3]
    expect(resultChunk).toContain('"reasoningOffsetEnd":26')
    expect(resultChunk).not.toContain('"reasoningOffsetStart"')
  })

  test('normalizes legacy tool payload to tool_call event', () => {
    const { emitter, chunks } = createEmitter()

    emitter.emitToolEvent({
      id: 'call-1',
      tool: 'web_search',
      stage: 'start',
      query: 'lobehub cot',
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('"type":"tool_call"')
    expect(chunks[0]).toContain('"callId":"call-1"')
    expect(chunks[0]).toContain('"identifier":"web_search"')
    expect(chunks[0]).toContain('"phase":"executing"')
    expect(chunks[0]).toContain('"status":"running"')
  })
})
