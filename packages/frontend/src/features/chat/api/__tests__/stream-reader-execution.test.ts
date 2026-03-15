import { describe, expect, it } from 'vitest'
import { normalizeChunk } from '../stream-reader'

describe('stream-reader unified execution events', () => {
  it('maps step_delta content into content chunk', () => {
    const chunk = normalizeChunk({
      type: 'step_delta',
      runId: 'chat-run-1',
      eventId: 'evt-1',
      ts: Date.now(),
      status: 'running',
      stepId: 'assistant-main',
      payload: {
        channel: 'content',
        delta: 'hello',
      },
    })

    expect(chunk).toEqual({ type: 'content', content: 'hello' })
  })

  it('maps step_delta reasoning into reasoning chunk', () => {
    const chunk = normalizeChunk({
      type: 'step_delta',
      runId: 'chat-run-1',
      eventId: 'evt-2',
      ts: Date.now(),
      status: 'running',
      stepId: 'assistant-main',
      payload: {
        channel: 'reasoning',
        delta: 'thinking',
      },
    })

    expect(chunk).toMatchObject({ type: 'reasoning', content: 'thinking' })
  })

  it('maps run_metrics into usage chunk', () => {
    const chunk = normalizeChunk({
      type: 'run_metrics',
      runId: 'chat-run-1',
      eventId: 'evt-3',
      ts: Date.now(),
      status: 'running',
      payload: {
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          total_tokens: 3,
        },
      },
    })

    expect(chunk).toMatchObject({
      type: 'usage',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    })
  })

  it('maps run_complete into complete chunk', () => {
    const chunk = normalizeChunk({
      type: 'run_complete',
      runId: 'chat-run-1',
      eventId: 'evt-4',
      ts: Date.now(),
      status: 'completed',
      payload: {},
    })

    expect(chunk).toEqual({ type: 'complete' })
  })

  it('maps run_error into error chunk', () => {
    const chunk = normalizeChunk({
      type: 'run_error',
      runId: 'chat-run-1',
      eventId: 'evt-5',
      ts: Date.now(),
      status: 'error',
      payload: {
        message: 'boom',
      },
    })

    expect(chunk).toMatchObject({ type: 'error', error: 'boom' })
  })
})
