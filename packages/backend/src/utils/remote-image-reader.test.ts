import { readRemoteImages } from './remote-image-reader'

declare const jest: any

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6Kf0cAAAAASUVORK5CYII='

describe('readRemoteImages', () => {
  it('downloads and validates public image candidates', async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'), {
        status: 200,
        headers: {
          'content-type': 'image/png',
          'content-length': '68',
        },
      }),
    ) as typeof fetch

    const result = await readRemoteImages(
      [
        {
          url: 'https://cdn.example.com/a.png',
          alt: '图A',
          source: 'content',
        },
      ],
      { fetchImpl },
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      url: 'https://cdn.example.com/a.png',
      mime: 'image/png',
      alt: '图A',
      source: 'content',
    })
    expect(result[0]?.data).toBe(ONE_BY_ONE_PNG_BASE64)
  })

  it('skips invalid or non-image responses', async () => {
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('valid.png')) {
        return new Response(Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'), {
          status: 200,
          headers: {
            'content-type': 'image/png',
          },
        })
      }
      return new Response('not-image', {
        status: 200,
        headers: {
          'content-type': 'text/html',
        },
      })
    }) as typeof fetch

    const result = await readRemoteImages(
      [
        { url: 'http://127.0.0.1/private.png' },
        { url: 'https://cdn.example.com/not-image' },
        { url: 'https://cdn.example.com/valid.png' },
      ],
      { fetchImpl },
    )

    expect(result).toHaveLength(1)
    expect(result[0]?.url).toBe('https://cdn.example.com/valid.png')
  })
})
