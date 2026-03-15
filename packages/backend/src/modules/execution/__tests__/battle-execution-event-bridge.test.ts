import { describe, expect, it } from '@jest/globals'
import { createBattleExecutionEventBridge } from '../battle-execution-event-bridge'

describe('battle execution event bridge', () => {
  it('maps legacy battle events into unified execution events', () => {
    const bridge = createBattleExecutionEventBridge({
      runKey: 'battle-run-99',
      sourceType: 'battle',
      sourceId: '99',
    })

    const runStart = bridge.consume({
      type: 'run_start',
      payload: {
        id: 99,
        mode: 'multi_model',
        title: 'battle',
      },
    })

    expect(runStart.map((item) => item.type)).toEqual(['run_start', 'plan_ready'])
    expect(runStart[0]?.runId).toBe('battle-run-99')
    expect(runStart[0]?.status).toBe('running')

    const stepStart = bridge.consume({
      type: 'attempt_start',
      payload: {
        modelId: 'gpt-4.1',
        modelKey: 'gpt-4.1#1',
        attemptIndex: 1,
        questionIndex: 1,
      },
    })

    expect(stepStart).toHaveLength(1)
    expect(stepStart[0]?.type).toBe('step_start')
    expect(stepStart[0]?.stepId).toBe('gpt-4.1#1:q1:a1')

    const stepDelta = bridge.consume({
      type: 'attempt_delta',
      payload: {
        modelKey: 'gpt-4.1#1',
        attemptIndex: 1,
        questionIndex: 1,
        delta: 'hello',
      },
    })
    expect(stepDelta).toHaveLength(1)
    expect(stepDelta[0]?.type).toBe('step_delta')
    expect((stepDelta[0]?.payload as any)?.channel).toBe('content')

    const stepComplete = bridge.consume({
      type: 'attempt_complete',
      payload: {
        modelKey: 'gpt-4.1#1',
        attemptIndex: 1,
        questionIndex: 1,
        result: {
          modelId: 'gpt-4.1',
          attemptIndex: 1,
          error: null,
        },
      },
    })

    expect(stepComplete).toHaveLength(1)
    expect(stepComplete[0]?.type).toBe('step_complete')
    expect(stepComplete[0]?.status).toBe('completed')

    const done = bridge.consume({
      type: 'run_complete',
      payload: {
        id: 99,
        summary: { totalModels: 1 },
      },
    })

    expect(done.map((item) => item.type)).toEqual(['run_metrics', 'run_complete'])
    expect(done[1]?.status).toBe('completed')
  })
})
