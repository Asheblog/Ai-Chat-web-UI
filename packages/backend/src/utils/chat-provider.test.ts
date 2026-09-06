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
})
