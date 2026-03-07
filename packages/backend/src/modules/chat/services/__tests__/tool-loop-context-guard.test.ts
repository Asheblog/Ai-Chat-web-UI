import { guardToolLoopMessages } from '../tool-loop-context-guard'

describe('tool-loop-context-guard', () => {
  it('keeps messages untouched when total tokens are within limit', async () => {
    const messages = [
      { role: 'system', content: '系统提示' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，我在。' },
    ]

    const result = await guardToolLoopMessages({
      messages,
      contextLimit: 8000,
      mode: 'normal',
    })

    expect(result.changed).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  it('compresses oversized old tool messages and preserves latest user input', async () => {
    const heavySummary = Array.from({ length: 2200 }, (_, idx) => `token_${idx}`).join(' ')
    const longToolPayload = JSON.stringify({
      summary: heavySummary,
      taskResults: Array.from({ length: 20 }).map((_, idx) => ({
        id: idx + 1,
        text: `snippet_${idx}_${Array.from({ length: 40 }, (_v, n) => `w${n}`).join(' ')}`,
      })),
    })

    const messages = [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '先帮我联网查资料' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } }],
      },
      {
        role: 'tool',
        name: 'web_search',
        tool_call_id: 'call_1',
        content: longToolPayload,
      },
      { role: 'user', content: '继续总结并回答重点' },
    ]

    const result = await guardToolLoopMessages({
      messages,
      contextLimit: 320,
      mode: 'normal',
    })

    expect(result.changed).toBe(true)
    expect(result.afterTokens).toBeLessThan(result.beforeTokens)
    expect(result.messages[result.messages.length - 1]).toMatchObject({
      role: 'user',
      content: '继续总结并回答重点',
    })

    const compressedToolMessage = result.messages.find((item) => item.role === 'tool')
    expect(typeof compressedToolMessage?.content).toBe('string')
    expect(String(compressedToolMessage?.content)).toContain('工具结果')
    expect(String(compressedToolMessage?.content).length).toBeLessThan(longToolPayload.length)
  })

  it('aggressive mode can further reduce context compared with normal mode', async () => {
    const hugeTool = Array.from({ length: 3200 }, (_, idx) => `result_piece_${idx}`).join(' ')
    const messages = [
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '问题 A' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', name: 'web_search', content: hugeTool },
      { role: 'assistant', content: '收到' },
      { role: 'user', content: '请继续' },
    ]

    const normal = await guardToolLoopMessages({
      messages,
      contextLimit: 320,
      mode: 'normal',
    })
    const aggressive = await guardToolLoopMessages({
      messages,
      contextLimit: 320,
      mode: 'aggressive',
    })

    expect(aggressive.afterTokens).toBeLessThanOrEqual(normal.afterTokens)
  })
})
