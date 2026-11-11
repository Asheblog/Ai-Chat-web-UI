import { buildHeaders, fetchModelsForConnection } from '../providers'

describe('anthropic provider foundation', () => {
  it('builds x-api-key and anthropic-version headers', async () => {
    const headers = await buildHeaders('anthropic', 'bearer', 'sk-ant-test')
    expect(headers['x-api-key']).toBe('sk-ant-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers.Authorization).toBeUndefined()
  })

  it('lets extra headers override the anthropic version', async () => {
    const headers = await buildHeaders('anthropic', 'bearer', 'sk-ant-test', {
      'anthropic-version': '2024-01-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    })
    expect(headers['anthropic-version']).toBe('2024-01-01')
    expect(headers['anthropic-beta']).toBe('interleaved-thinking-2025-05-14')
  })

  it('lists anthropic models through GET /models', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        data: [
          { id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5' },
          { id: 'claude-haiku-4-5' },
        ],
        has_more: false,
      }),
      text: async () => '',
    } as any)

    const models = await fetchModelsForConnection({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      enable: true,
      authType: 'bearer',
      apiKey: 'sk-ant-test',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models?limit=1000',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
    expect(models.map((model) => [model.rawId, model.name])).toEqual([
      ['claude-sonnet-4-5', 'Claude Sonnet 4.5'],
      ['claude-haiku-4-5', 'claude-haiku-4-5'],
    ])
    expect(models[0].provider).toBe('anthropic')
    fetchMock.mockRestore()
  })
})
