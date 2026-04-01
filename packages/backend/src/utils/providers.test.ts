declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => Promise<void> | void) => void
declare const afterEach: (fn: () => void) => void
declare const expect: any
declare const jest: any

import { verifyConnection } from './providers'

describe('verifyConnection', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  it('accepts JSON bodies even when content-type is missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: () => null,
      },
      text: async () => JSON.stringify({ data: [] }),
      json: async () => ({ data: [] }),
    } as any)

    await expect(
      verifyConnection({
        provider: 'openai',
        baseUrl: 'https://example.com/v1',
        enable: true,
        authType: 'bearer',
        apiKey: 'sk-test',
      }),
    ).resolves.toBeUndefined()
  })
})
