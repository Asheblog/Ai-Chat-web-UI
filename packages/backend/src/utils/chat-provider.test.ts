import { buildChatProviderRequest } from './chat-provider'
import { resolveToolProviderAdapter } from '../agent-runtime/provider-adapters'

describe('Responses conversation requests', () => {
  it.each([
    { format: 'string', answer: 'Water vapor condenses.' },
    { format: 'text parts', answer: [{ type: 'text', text: 'Water vapor condenses.' }] },
  ])('replays a previous answer ($format) when the user follows up', ({ answer }) => {
    const imageUrl = 'https://example.com/cloud.png'
    const request = buildChatProviderRequest({
      provider: 'openai_responses',
      baseUrl: 'https://provider.example/v1',
      rawModelId: 'model',
      stream: true,
      body: {
        messages: [
          { role: 'system', content: 'Keep it brief.' },
          { role: 'user', content: 'What causes rain?' },
          { role: 'assistant', content: answer },
          { role: 'assistant', content: '' },
          { role: 'user', content: [
            { type: 'text', text: 'Is this a rain cloud?' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ] },
        ],
      },
    })

    expect(request.body.input).toEqual([
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'Keep it brief.' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'What causes rain?' }] },
      { type: 'message', role: 'assistant', content: [
        { type: 'output_text', text: 'Water vapor condenses.', annotations: [] },
      ] },
      { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'Is this a rain cloud?' },
        { type: 'input_image', detail: 'auto', image_url: imageUrl },
      ] },
    ])
  })
})

describe('retired provider rejection', () => {
  it.each(['azure_openai', 'ollama', 'unknown'])('rejects %s before constructing a request', (provider) => {
    expect(() => buildChatProviderRequest({
      provider: provider as any,
      baseUrl: 'https://provider.example',
      rawModelId: 'model',
      body: { messages: [] },
    })).toThrow('Unsupported provider')
  })

  it.each(['azure_openai', 'ollama', 'unknown'])('rejects %s tool adapters', (provider) => {
    expect(() => resolveToolProviderAdapter(provider)).toThrow('Unsupported provider')
  })

  it('builds an Anthropic messages request with sse stream mode', () => {
    const request = buildChatProviderRequest({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1/',
      rawModelId: 'claude-sonnet-4-5',
      body: {
        messages: [
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'hi' },
        ],
        stream: true,
      },
      stream: true,
    })

    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.streamMode).toBe('sse')
    expect(request.body).toMatchObject({
      model: 'claude-sonnet-4-5',
      system: 'be brief',
      stream: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
  })

  it('accepts the anthropic tool adapter', () => {
    expect(() => resolveToolProviderAdapter('anthropic')).not.toThrow()
  })
})
