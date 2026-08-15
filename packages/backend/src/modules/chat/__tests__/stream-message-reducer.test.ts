import {
  appendContentText,
  appendReasoningText,
  contentToText,
  shouldAppendReasoningDelta,
  upsertToolEventFromChunk,
} from '@aichat/shared/stream-message-reducer'
import type { ToolEvent } from '@aichat/shared/tool-events'
import type { ChatStreamChunk } from '@aichat/shared/chat-stream-contract'

describe('stream-message-reducer', () => {
  test('contentToText 兼容 string 与结构化 content', () => {
    expect(contentToText('plain')).toBe('plain')
    expect(contentToText({ text: 'text-field' })).toBe('text-field')
    expect(contentToText({ content: 'content-field' })).toBe('content-field')
    expect(contentToText({ other: 'x' })).toBe('')
    expect(contentToText(null)).toBe('')
  })

  test('appendContentText / appendReasoningText 做流式增量拼接', () => {
    expect(appendContentText({ text: 'hello' }, '!')).toBe('hello!')
    expect(appendReasoningText(null, 'a')).toBe('a')
    expect(appendReasoningText('a', 'b')).toBe('ab')
  })

  test('shouldAppendReasoningDelta 忽略工具进度 meta', () => {
    expect(shouldAppendReasoningDelta()).toBe(true)
    expect(shouldAppendReasoningDelta({ kind: 'other' })).toBe(true)
    expect(shouldAppendReasoningDelta({ kind: 'tool' })).toBe(false)
  })

  test('tool_call start 创建事件并回填 reasoningOffsetStart', () => {
    const events = upsertToolEventFromChunk<ToolEvent>([], toolChunk({
      callId: 'call-1',
      identifier: 'web_search',
      stage: 'start',
      status: 'running',
      query: 'weather',
    }), {
      sessionId: 1,
      messageId: 'assistant-1',
      reasoningLength: 8,
      nowMs: 100,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      id: 'call-1',
      callId: 'call-1',
      sessionId: 1,
      messageId: 'assistant-1',
      tool: 'web_search',
      stage: 'start',
      status: 'running',
      query: 'weather',
      createdAt: 100,
      updatedAt: 100,
      details: { reasoningOffsetStart: 8, reasoningOffset: 8 },
    })
  })

  test('result chunk 按 callId 合并并回填 reasoningOffsetEnd', () => {
    const created = upsertToolEventFromChunk<ToolEvent>([], toolChunk({
      callId: 'call-1',
      identifier: 'web_search',
      stage: 'start',
      status: 'running',
    }), {
      sessionId: 1,
      messageId: 'assistant-1',
      reasoningLength: 8,
      nowMs: 100,
    })

    const merged = upsertToolEventFromChunk(created, toolChunk({
      callId: 'call-1',
      identifier: 'web_search',
      stage: 'result',
      status: 'success',
      summary: '3 hits',
    }), {
      sessionId: 1,
      messageId: 'assistant-1',
      reasoningLength: 12,
      nowMs: 200,
    })

    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      stage: 'result',
      status: 'success',
      summary: '3 hits',
      createdAt: 100,
      updatedAt: 200,
      details: {
        reasoningOffsetStart: 8,
        reasoningOffsetEnd: 12,
        reasoningOffset: 8,
      },
    })
  })

  test('不同 session 的同名 callId 不互相合并', () => {
    const sessionA = upsertToolEventFromChunk<ToolEvent>([], toolChunk({
      callId: 'call-1',
      tool: 'python_runner',
      stage: 'start',
    }), {
      sessionId: 1,
      messageId: 'a-1',
      reasoningLength: 0,
      nowMs: 100,
    })

    const sessionB = upsertToolEventFromChunk(sessionA, toolChunk({
      callId: 'call-1',
      tool: 'python_runner',
      stage: 'result',
      status: 'success',
    }), {
      sessionId: 2,
      messageId: 'b-1',
      reasoningLength: 0,
      nowMs: 200,
    })

    expect(sessionB).toHaveLength(2)
    expect(sessionB[0].sessionId).toBe(1)
    expect(sessionB[0].stage).toBe('start')
    expect(sessionB[1].sessionId).toBe(2)
    expect(sessionB[1].stage).toBe('result')
  })

  test('details / arguments / result 字段增量覆盖并保留历史值', () => {
    const created = upsertToolEventFromChunk<ToolEvent>([], toolChunk({
      callId: 'call-1',
      apiName: 'web_search',
      stage: 'start',
      argumentsPatch: '{',
      details: { engine: 'tavily' },
    }), {
      sessionId: 1,
      messageId: 1,
      reasoningLength: 0,
      nowMs: 100,
    })
    expect(created[0]).toMatchObject({
      tool: 'web_search',
      identifier: 'web_search',
      apiName: 'web_search',
      argumentsPatch: '{',
      details: { engine: 'tavily' },
    })

    const merged = upsertToolEventFromChunk(created, toolChunk({
      callId: 'call-1',
      apiName: 'web_search',
      stage: 'result',
      argumentsPatch: '{}',
      resultText: 'ok',
      resultJson: { hits: 1 },
    }), {
      sessionId: 1,
      messageId: 1,
      reasoningLength: 0,
      nowMs: 200,
    })

    expect(merged[0]).toMatchObject({
      argumentsPatch: '{}',
      resultText: 'ok',
      resultJson: { hits: 1 },
      details: { engine: 'tavily', argumentsPatch: '{}', resultText: 'ok', resultJson: { hits: 1 } },
    })
  })
})

const toolChunk = (override: Partial<ChatStreamChunk>): ChatStreamChunk => ({
  type: 'tool_call',
  ...override,
})
