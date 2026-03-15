import { createChatExecutionEventBridge } from '../chat-execution-event-bridge'

describe('chat execution event bridge', () => {
  it('maps legacy chat stream events into unified execution events', () => {
    const bridge = createChatExecutionEventBridge({
      runKey: 'chat-run-test',
      sessionId: 123,
      sourceId: 'client-msg-1',
      clock: () => 1700000000000,
    })

    const start = bridge.consume({
      type: 'start',
      assistantMessageId: 99,
      assistantClientMessageId: 'assistant-client-99',
    })
    expect(start.map((item) => item.type)).toEqual(['run_start', 'plan_ready', 'step_start'])
    expect(start[0]).toMatchObject({
      runId: 'chat-run-test',
      status: 'running',
      payload: expect.objectContaining({
        sourceType: 'chat',
        sourceId: 'client-msg-1',
      }),
    })
    expect(start[2]).toMatchObject({
      stepId: 'assistant-client-99',
      agentRole: 'assistant',
    })

    const content = bridge.consume({
      type: 'content',
      content: 'hello',
    })
    expect(content).toHaveLength(1)
    expect(content[0]).toMatchObject({
      type: 'step_delta',
      stepId: 'assistant-client-99',
      payload: {
        channel: 'content',
        delta: 'hello',
      },
    })

    const usage = bridge.consume({
      type: 'usage',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({
      type: 'run_metrics',
      payload: {
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      },
    })

    const complete = bridge.consume({ type: 'complete' })
    expect(complete.map((item) => item.type)).toEqual(['step_complete', 'run_complete', 'complete'])
    expect(complete[0]).toMatchObject({
      stepId: 'assistant-client-99',
      status: 'completed',
    })
    expect(complete[1]).toMatchObject({
      type: 'run_complete',
      status: 'completed',
    })
  })

  it('emits run_error and complete on legacy error event', () => {
    const bridge = createChatExecutionEventBridge({
      runKey: 'chat-run-test-2',
      sessionId: 1,
    })

    const events = bridge.consume({
      type: 'error',
      error: 'stream failed',
    })

    expect(events.map((item) => item.type)).toEqual([
      'run_start',
      'plan_ready',
      'step_start',
      'step_complete',
      'run_error',
      'complete',
    ])
    expect(events[4]).toMatchObject({
      type: 'run_error',
      status: 'error',
      payload: {
        message: 'stream failed',
      },
    })
  })
})
