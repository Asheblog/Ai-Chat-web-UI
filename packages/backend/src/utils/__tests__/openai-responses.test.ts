import { convertChatCompletionsRequestToResponses } from '../openai-responses'

describe('convertChatCompletionsRequestToResponses', () => {
  it('把 Chat Completions 嵌套 function tools 转成 Responses 顶层 name 形态', () => {
    const result = convertChatCompletionsRequestToResponses({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'web_search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'read_url',
            description: 'Read a URL',
            parameters: { type: 'object', properties: { url: { type: 'string' } } },
            strict: false,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'web_search' } },
    })

    expect(result.tools).toEqual([
      {
        type: 'function',
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      {
        type: 'function',
        name: 'read_url',
        description: 'Read a URL',
        parameters: { type: 'object', properties: { url: { type: 'string' } } },
        strict: false,
      },
    ])
    expect(result.tool_choice).toEqual({ type: 'function', name: 'web_search' })
    expect(result.tools[0]).not.toHaveProperty('function')
  })

  it('已是 Responses 形态或非 function 工具时保持可发送', () => {
    const result = convertChatCompletionsRequestToResponses({
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          name: 'already_flat',
          description: 'ok',
          parameters: { type: 'object', properties: {} },
        },
        { type: 'web_search' },
      ],
      tool_choice: 'auto',
    })

    expect(result.tools).toEqual([
      {
        type: 'function',
        name: 'already_flat',
        description: 'ok',
        parameters: { type: 'object', properties: {} },
      },
      { type: 'web_search' },
    ])
    expect(result.tool_choice).toBe('auto')
  })
})
