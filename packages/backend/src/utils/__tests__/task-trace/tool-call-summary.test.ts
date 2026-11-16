jest.mock('../../../db', () => ({ prisma: {} }))

import { classifyTraceEventTier, summarizeSsePayload } from '../../task-trace'

const readUrlFailurePayload = () => ({
  type: 'tool_call',
  id: 'call-1',
  callId: 'call-1',
  tool: 'read_url',
  identifier: 'read_url',
  apiName: 'read_url',
  source: 'builtin',
  phase: 'error',
  stage: 'error',
  status: 'error',
  query: 'https://www.cnbc.com/2026/11/16/markets.html',
  url: 'https://www.cnbc.com/2026/11/16/markets.html',
  summary: '网页读取失败，已回退到搜索摘要',
  error: 'JavaScript challenge detected',
  details: {
    groupId: 'call-1',
    url: 'https://www.cnbc.com/2026/11/16/markets.html',
    rank: 1,
    autoTriggered: true,
    taskType: 'read_url',
    errorCode: 'JS_CHALLENGE',
    fallbackUsed: 'search_snippet',
    attempts: [
      { engine: 'native', status: 'error', durationMs: 1200, errorCode: 'JS_CHALLENGE' },
      { engine: 'browser', status: 'skipped', durationMs: 0 },
    ],
    headers: { authorization: 'Bearer sk-secret-token' },
    argumentsText: '{"apiKey":"sk-secret-token"}',
  },
})

describe('summarizeSsePayload for tool calls', () => {
  it('keeps the failure details that used to collapse to { type: tool_call }', () => {
    const summary = summarizeSsePayload(readUrlFailurePayload())

    expect(summary).toMatchObject({
      type: 'tool_call',
      tool: 'read_url',
      stage: 'error',
      phase: 'error',
      status: 'error',
      error: 'JavaScript challenge detected',
      errorCode: 'JS_CHALLENGE',
      fallbackUsed: 'search_snippet',
      callId: 'call-1',
    })
    expect(String(summary.url)).toContain('cnbc.com')
    expect(summary.summaryText).toBe('网页读取失败，已回退到搜索摘要')
  })

  it('keeps per-attempt engines and error codes without copying the raw attempt object', () => {
    const summary = summarizeSsePayload(readUrlFailurePayload())
    const attempts = summary.attempts as { count: number; kept: Array<Record<string, unknown>> }

    expect(attempts.count).toBe(2)
    expect(attempts.kept[0]).toEqual({
      engine: 'native',
      status: 'error',
      durationMs: 1200,
      errorCode: 'JS_CHALLENGE',
      httpStatus: undefined,
      error: undefined,
    })
  })

  it('never carries request headers or tool arguments into the trace', () => {
    const summary = summarizeSsePayload(readUrlFailurePayload())
    const serialized = JSON.stringify(summary)

    expect(serialized).not.toContain('sk-secret-token')
    expect(serialized).not.toContain('authorization')
    expect(serialized).not.toContain('argumentsText')
    expect(summary.headers).toBeUndefined()
  })

  it('keeps the tool call identity and hits count for a successful search', () => {
    const summary = summarizeSsePayload({
      type: 'tool_call',
      id: 'call-2',
      tool: 'web_search',
      stage: 'result',
      status: 'success',
      query: '人民币汇率',
      hits: [{ title: 'a' }, { title: 'b' }],
      details: { engineCount: 2 },
    })

    expect(summary).toMatchObject({ tool: 'web_search', stage: 'result', hits: 2 })
  })

  it('classifies failing tool calls as critical and successful ones as normal', () => {
    const failure = summarizeSsePayload(readUrlFailurePayload())
    const success = summarizeSsePayload({ type: 'tool_call', tool: 'web_search', stage: 'result', status: 'success' })

    expect(classifyTraceEventTier('tool:event', failure)).toBe('critical')
    expect(classifyTraceEventTier('tool:event', success)).toBe('normal')
    expect(classifyTraceEventTier('sse:dispatch', failure)).toBe('noise')
    expect(classifyTraceEventTier('db:persist_progress', { length: 1 })).toBe('noise')
    expect(classifyTraceEventTier('db:persist_final', { length: 1 })).toBe('critical')
  })
})
