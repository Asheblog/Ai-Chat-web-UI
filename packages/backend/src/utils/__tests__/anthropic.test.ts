import {
  adaptProviderResponse,
  convertAnthropicMessageToChatCompletion,
  convertChatCompletionsRequestToAnthropic,
  convertAnthropicSseChunk,
  createAnthropicSseState,
  finishAnthropicSse,
} from '../anthropic'

const dataFrames = (raw: string): any[] =>
  raw
    .split('\n\n')
    .map((frame) => frame.trim())
    .filter(Boolean)
    .map((frame) => frame.replace(/^data: /, ''))
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data))

describe('convertChatCompletionsRequestToAnthropic', () => {
  it('converts system, messages, images, tools and thinking', () => {
    const body = convertChatCompletionsRequestToAnthropic({
      model: 'claude-sonnet-4-5',
      temperature: 1.4,
      max_tokens: 2000,
      stream: true,
      messages: [
        { role: 'system', content: 'S1' },
        { role: 'system', content: [{ type: 'text', text: 'S2' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
          ],
        },
        {
          role: 'assistant',
          content: 'calling',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'search', arguments: '{"q":"x"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: 'result-1' },
        { role: 'tool', tool_call_id: 'call_2', content: 'result-2' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: { q: { type: 'string' } },
              required: ['q'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      reasoning_effort: 'medium',
    })

    expect(body.model).toBe('claude-sonnet-4-5')
    expect(body.system).toBe('S1\n\nS2')
    expect(body.stream).toBe(true)
    expect(body.temperature).toBe(1)
    expect(body.max_tokens).toBeGreaterThan(4096)
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4096 })
    expect(body.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'describe' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        },
      ],
    })
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'x' } },
      ],
    })
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'result-1' },
        { type: 'tool_result', tool_use_id: 'call_2', content: 'result-2' },
      ],
    })
    expect(body.tools).toEqual([
      {
        name: 'search',
        description: 'Search the web',
        input_schema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
      },
    ])
    expect(body.tool_choice).toEqual({ type: 'auto' })
  })

  it('keeps budget_tokens strictly below max_tokens', () => {
    const body = convertChatCompletionsRequestToAnthropic({
      model: 'claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'hi' }],
      reasoning_effort: 'max',
    })
    expect(body.max_tokens).toBeGreaterThan(body.thinking.budget_tokens)
  })

  it('maps http image urls to url image sources', () => {
    const body = convertChatCompletionsRequestToAnthropic({
      model: 'claude-sonnet-4-5',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
        },
      ],
    })
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'url', url: 'https://example.com/a.png' },
    })
  })
})

describe('convertAnthropicMessageToChatCompletion', () => {
  it('maps content blocks, tool calls, stop reason and usage', () => {
    const json = convertAnthropicMessageToChatCompletion({
      id: 'msg_1',
      model: 'claude-sonnet-4-5',
      content: [
        { type: 'thinking', thinking: 'deep thought' },
        { type: 'text', text: 'hello' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'x' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
    })

    expect(json.id).toBe('msg_1')
    expect(json.object).toBe('chat.completion')
    expect(json.choices[0].message.content).toBe('hello')
    expect(json.choices[0].message.reasoning_content).toBe('deep thought')
    expect(json.choices[0].message.tool_calls).toEqual([
      {
        id: 'toolu_1',
        type: 'function',
        function: { name: 'search', arguments: '{"q":"x"}' },
      },
    ])
    expect(json.choices[0].finish_reason).toBe('tool_calls')
    expect(json.usage).toEqual({
      prompt_tokens: 13,
      completion_tokens: 5,
      total_tokens: 18,
      prompt_tokens_details: { cached_tokens: 3 },
    })
  })

  it('maps end_turn to stop and leaves already-openai payloads untouched', () => {
    const openai = { choices: [{ message: { role: 'assistant', content: 'ok' } }] }
    expect(convertAnthropicMessageToChatCompletion(openai)).toBe(openai)
    const json = convertAnthropicMessageToChatCompletion({
      type: 'message',
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 2 },
    })
    expect(json.choices[0].finish_reason).toBe('stop')
  })
})

describe('anthropic SSE to OpenAI chunks', () => {
  it('converts text, thinking, tool input deltas, usage and done marker', () => {
    const state = createAnthropicSseState()
    let output = ''
    output += convertAnthropicSseChunk(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-sonnet-4-5","usage":{"input_tokens":12,"output_tokens":1}}}',
        '',
        '',
      ].join('\n'),
      state,
    )
    output += convertAnthropicSseChunk(
      [
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"search","input":{}}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"thinking_delta","thinking":"why"}}',
        '',
        '',
      ].join('\n'),
      state,
    )
    output += convertAnthropicSseChunk(
      [
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
        '',
      ].join('\n'),
      state,
    )
    output += finishAnthropicSse(state)

    expect(output).toContain('data: [DONE]')
    const frames = dataFrames(output)
    expect(frames[0].choices[0].delta.role).toBe('assistant')
    expect(frames.some((frame) => frame.choices?.[0]?.delta?.content === 'Hi')).toBe(true)
    expect(frames.some((frame) => frame.choices?.[0]?.delta?.reasoning_content === 'why')).toBe(true)
    const toolDelta = frames
      .flatMap((frame) => frame.choices?.[0]?.delta?.tool_calls || [])
      .find((call: any) => call.id === 'toolu_1')
    expect(toolDelta).toMatchObject({
      index: 0,
      id: 'toolu_1',
      type: 'function',
      function: { name: 'search' },
    })
    const argumentDelta = frames
      .flatMap((frame) => frame.choices?.[0]?.delta?.tool_calls || [])
      .map((call: any) => call.function?.arguments || '')
      .join('')
    expect(argumentDelta).toContain('{"q":"x"}')
    const final = frames[frames.length - 1]
    expect(final.choices[0].finish_reason).toBe('tool_calls')
    expect(final.usage).toEqual({ prompt_tokens: 12, completion_tokens: 9, total_tokens: 21 })
  })
})

describe('adaptProviderResponse', () => {
  it('converts a JSON response even when stream was requested', async () => {
    const upstream = new Response(
      JSON.stringify({
        id: 'msg_json',
        type: 'message',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    const adapted = await adaptProviderResponse(upstream, 'anthropic', true)
    const json: any = await adapted.json()
    expect(json.choices[0].message.content).toBe('ok')
    expect(adapted.headers.get('content-length')).toBeNull()
  })
})