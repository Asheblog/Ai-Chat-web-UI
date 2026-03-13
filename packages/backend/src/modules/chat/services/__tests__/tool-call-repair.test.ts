import {
  extractMissingFunctionCallOutputId,
  pruneMissingToolCallReferences,
} from '../tool-call-repair'

describe('tool-call-repair', () => {
  it('extracts call id from function_call_output mismatch error', () => {
    const error = new Error(
      'AI provider request failed (400): {"error":{"message":"No tool call found for function call output with call_id call_abc123."}}',
    )

    expect(extractMissingFunctionCallOutputId(error)).toBe('call_abc123')
  })

  it('prunes assistant tool_call and tool output for the same call id', () => {
    const messages: any[] = [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '搜索今日新闻' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_good', type: 'function', function: { name: 'web_search', arguments: '{"query":"today"}' } },
          { id: 'call_bad', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_bad', name: 'web_search', content: '{"error":"Missing query parameter"}' },
      { role: 'tool', tool_call_id: 'call_good', name: 'web_search', content: '{"query":"today","hits":[]}' },
    ]

    const result = pruneMissingToolCallReferences(messages, 'call_bad')

    expect(result.changed).toBe(true)
    expect(result.removedAssistantCalls).toBe(1)
    expect(result.removedToolMessages).toBe(1)
    expect(messages.some((msg) => msg?.role === 'tool' && msg?.tool_call_id === 'call_bad')).toBe(false)
    const assistant = messages.find((msg) => msg?.role === 'assistant' && Array.isArray(msg?.tool_calls))
    expect(assistant?.tool_calls).toHaveLength(1)
    expect(assistant?.tool_calls?.[0]?.id).toBe('call_good')
  })

  it('returns unchanged when call id is absent', () => {
    const messages: any[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]

    const result = pruneMissingToolCallReferences(messages, 'call_missing')

    expect(result.changed).toBe(false)
    expect(result.removedAssistantCalls).toBe(0)
    expect(result.removedToolMessages).toBe(0)
    expect(messages).toHaveLength(2)
  })
})
