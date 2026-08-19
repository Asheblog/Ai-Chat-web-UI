import { ensureMinVisionImageEdge } from '../vision-image-prepare'

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2iQAAAABJRU5ErkJggg=='

describe('ensureMinVisionImageEdge', () => {
  it('upscales a 1x1 png to at least 32px', async () => {
    const result = await ensureMinVisionImageEdge({ data: TINY_PNG, mime: 'image/png' })
    const buffer = Buffer.from(result.data, 'base64')
    expect(result.mime).toBe('image/png')
    expect(buffer.readUInt32BE(16)).toBeGreaterThanOrEqual(32)
    expect(buffer.readUInt32BE(20)).toBeGreaterThanOrEqual(32)
  })

  it('passes through undecodable payloads unchanged', async () => {
    const image = { data: 'aGVsbG8=', mime: 'image/png' }
    await expect(ensureMinVisionImageEdge(image)).resolves.toEqual(image)
  })
})
