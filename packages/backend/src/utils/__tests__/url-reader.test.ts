import { readUrlContent } from '../url-reader'

describe('readUrlContent error classification', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.restoreAllMocks()
  })

  test('classifies 403 challenge page as JS_CHALLENGE', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html><title>Just a moment...</title>cf-chl-bypass</html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/news')

    expect(result.errorCode).toBe('JS_CHALLENGE')
    expect(result.httpStatus).toBe(403)
  })

  test('classifies robots denied body as ROBOTS_DENIED', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html>blocked by robots policy</html>', {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/blocked')

    expect(result.errorCode).toBe('ROBOTS_DENIED')
    expect(result.httpStatus).toBe(403)
  })

  test('classifies dynamic challenge body with 200 status as JS_CHALLENGE', async () => {
    global.fetch = jest.fn(async () =>
      new Response('<html><body>Please enable JavaScript to continue</body></html>', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    ) as typeof fetch

    const result = await readUrlContent('https://example.com/challenge')

    expect(result.errorCode).toBe('JS_CHALLENGE')
    expect(result.error).toContain('JavaScript challenge')
  })
})

