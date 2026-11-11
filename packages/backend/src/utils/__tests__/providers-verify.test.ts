import { verifyConnection } from '../providers'

const fetchMock = jest.spyOn(globalThis, 'fetch' as any)

describe('verifyConnection anthropic', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterAll(() => {
    fetchMock.mockRestore()
  })

  it('falls back to /messages when /models returns 404 and a model id exists', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
        text: async () => 'not found',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{}',
        json: async () => ({}),
      } as any)

    await verifyConnection({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      enable: true,
      authType: 'bearer',
      apiKey: 'sk-ant-test',
      modelIds: ['claude-sonnet-4-5'],
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://api.anthropic.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('claude-sonnet-4-5'),
      }),
    )
  })

  it('fails explicitly when /models is unsupported and no model id exists', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      headers: new Headers(),
      text: async () => 'not found',
    } as any)

    await expect(
      verifyConnection({
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        enable: true,
        authType: 'bearer',
        apiKey: 'sk-ant-test',
      }),
    ).rejects.toThrow('/models unsupported')
  })
})