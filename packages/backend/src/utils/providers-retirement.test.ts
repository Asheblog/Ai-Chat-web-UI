import { buildHeaders, fetchModelsForConnection, verifyConnection, type ConnectionConfig } from './providers'

describe('retired provider boundaries', () => {
  test.each(['azure_openai', 'ollama', 'unknown'])('rejects %s before credentials or model discovery', async (provider) => {
    const config = { provider, baseUrl: 'https://example.com', authType: 'none', enable: true, modelIds: ['model'] } as ConnectionConfig
    await expect(buildHeaders(config.provider, config.authType)).rejects.toThrow(/Unsupported provider/)
    await expect(fetchModelsForConnection(config)).rejects.toThrow(/Unsupported provider/)
    await expect(verifyConnection(config)).rejects.toThrow(/Unsupported provider/)
  })
})
