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
})
