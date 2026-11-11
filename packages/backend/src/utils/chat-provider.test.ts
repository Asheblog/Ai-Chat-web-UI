import { buildChatProviderRequest } from './chat-provider'
import { resolveToolProviderAdapter } from '../agent-runtime/provider-adapters'

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
