import { createEmbeddingProvider, OpenAIEmbeddingProvider, type EmbeddingConfig } from './embedding-service'

describe('embedding provider selection', () => {
  test('rejects a retired engine from persisted or untyped configuration', () => {
    expect(() => createEmbeddingProvider({ engine: 'ollama', model: 'model' } as unknown as EmbeddingConfig)).toThrow('Unknown embedding engine')
  })

  test('keeps OpenAI-compatible embeddings', () => {
    expect(createEmbeddingProvider({ engine: 'openai', model: 'text-embedding-3-small', apiKey: 'test' })).toBeInstanceOf(OpenAIEmbeddingProvider)
  })
})
