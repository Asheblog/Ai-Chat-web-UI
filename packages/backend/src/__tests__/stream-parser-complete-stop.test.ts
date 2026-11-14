import { normalizeStreamChunk } from '@aichat/shared/chat-stream-parser'

const runComplete = (summary: Record<string, unknown>) =>
  normalizeStreamChunk({
    type: 'run_complete',
    runId: 'run-1',
    eventId: 'run-1:evt:9',
    ts: 1,
    status: 'completed',
    payload: {
      output: { content: '最终回答' },
      summary,
    },
  })

describe('run_complete 透传 stopReason / finalAnswerGenerated', () => {
  test('stop_tools + finalAnswerGenerated=false 不构成 done 成功', () => {
    const chunk = runComplete({ stopReason: 'stop_tools', finalAnswerGenerated: false })
    expect(chunk).toEqual({
      type: 'complete',
      content: '最终回答',
      stopReason: 'stop_tools',
      finalAnswerGenerated: false,
    })
    expect(chunk?.streamStatus).toBeUndefined()
  })

  test('budget_exhausted 与已生成最终回答可同时出现', () => {
    const chunk = runComplete({
      streamStatus: 'done',
      stopReason: 'budget_exhausted',
      finalAnswerGenerated: true,
    })
    expect(chunk?.streamStatus).toBe('done')
    expect(chunk?.stopReason).toBe('budget_exhausted')
    expect(chunk?.finalAnswerGenerated).toBe(true)
  })

  test('未知 stopReason 与非布尔 finalAnswerGenerated 不透传', () => {
    const chunk = runComplete({ stopReason: 'user_cancelled', finalAnswerGenerated: 'false' })
    expect(chunk?.type).toBe('complete')
    expect(chunk?.stopReason).toBeUndefined()
    expect(chunk?.finalAnswerGenerated).toBeUndefined()
  })

  test('summary 缺字段时不补默认值', () => {
    const chunk = runComplete({})
    expect(chunk).toEqual({ type: 'complete', content: '最终回答' })
  })
})

describe('legacy complete 事件透传 stopReason / finalAnswerGenerated', () => {
  test('路由下发的 complete 带 stopReason 与 finalAnswerGenerated=false', () => {
    const chunk = normalizeStreamChunk({
      type: 'complete',
      streamStatus: 'done',
      stopReason: 'stop_tools',
      finalAnswerGenerated: false,
    })
    expect(chunk?.type).toBe('complete')
    expect(chunk?.stopReason).toBe('stop_tools')
    expect(chunk?.finalAnswerGenerated).toBe(false)
  })

  test('只有 finalAnswerGenerated 时也保留 false 而不是省略', () => {
    const chunk = normalizeStreamChunk({ type: 'complete', finalAnswerGenerated: false })
    expect(chunk?.finalAnswerGenerated).toBe(false)
    expect(chunk?.stopReason).toBeUndefined()
  })

  test('非法取值的 stopReason 被丢弃', () => {
    const chunk = normalizeStreamChunk({ type: 'complete', stopReason: 'aborted' })
    expect(chunk?.stopReason).toBeUndefined()
  })
})
