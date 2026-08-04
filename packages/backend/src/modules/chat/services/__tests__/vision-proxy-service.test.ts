import {
  VisionProxyService,
  VisionProxyServiceError,
  loadVisionProxyConfig,
  isVisionProxyReady,
  parseStoredImageDescriptions,
  loadHistoryImageDescriptions,
} from '../vision-proxy-service'

const prisma = {
  connection: { findUnique: jest.fn() },
  message: { findMany: jest.fn() },
} as any

const config = { enabled: true, connectionId: 1, modelId: 'qwen-vl-max' }
const images = [{ data: 'aGVsbG8=', mime: 'image/png' }]

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response

describe('loadVisionProxyConfig', () => {
  it('parses sysMap with env fallback', () => {
    const cfg = loadVisionProxyConfig({ image_transcription_enabled: 'true', image_transcription_connection_id: '3', image_transcription_model_id: 'gpt-4o' })
    expect(cfg).toEqual({ enabled: true, connectionId: 3, modelId: 'gpt-4o' })
  })
  it('disabled by default', () => {
    expect(loadVisionProxyConfig({}).enabled).toBe(false)
  })
})

describe('isVisionProxyReady', () => {
  it('requires enabled + connectionId + modelId', () => {
    expect(isVisionProxyReady({ enabled: true, connectionId: 1, modelId: 'm' })).toBe(true)
    expect(isVisionProxyReady({ enabled: false, connectionId: 1, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ enabled: true, connectionId: null, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ enabled: true, connectionId: 1, modelId: null })).toBe(false)
  })
})

describe('parseStoredImageDescriptions', () => {
  it('parses valid json, returns null otherwise', () => {
    expect(parseStoredImageDescriptions('[{"description":"一只猫","modelRawId":"qwen-vl-max"}]')).toEqual([{ description: '一只猫', modelRawId: 'qwen-vl-max' }])
    expect(parseStoredImageDescriptions(null)).toBeNull()
    expect(parseStoredImageDescriptions('bad')).toBeNull()
    expect(parseStoredImageDescriptions('[]')).toBeNull()
  })
})

describe('loadHistoryImageDescriptions', () => {
  it('maps messageId to parsed descriptions', async () => {
    prisma.message.findMany.mockResolvedValue([
      { id: 5, imageDescriptionsJson: '[{"description":"d1","modelRawId":"m"}]' },
      { id: 6, imageDescriptionsJson: 'bad' },
    ])
    const map = await loadHistoryImageDescriptions(prisma, 1, null)
    expect(map.get(5)).toEqual([{ description: 'd1', modelRawId: 'm' }])
    expect(map.has(6)).toBe(false)
  })
})

describe('VisionProxyService.transcribeImages', () => {
  const service = () => new VisionProxyService({ prisma, fetchFn: jest.fn() })

  it('throws 400 when config not ready', async () => {
    await expect(service().transcribeImages(images, '', { enabled: true, connectionId: null, modelId: null }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 404 when connection missing', async () => {
    prisma.connection.findUnique.mockResolvedValue(null)
    await expect(service().transcribeImages(images, '', config)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns description from openai-format response', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '  图片里有一只猫  ' } }] }))
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '这是什么？', config)
    expect(result.description).toBe('图片里有一只猫')
    expect(result.modelRawId).toBe('qwen-vl-max')
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toContain('/chat/completions')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen-vl-max')
    expect(body.messages[1].content[0].text).toContain('这是什么')
    expect(body.messages[1].content[1].image_url.url).toContain('data:image/png;base64,')
  })

  it('parses google_genai response', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'google_genai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }))
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)
    expect(result.description).toBe('ab')
  })

  it('maps http error to 502 VisionProxyServiceError', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })

  it('throws 502 on empty description', async () => {
    prisma.connection.findUnique.mockResolvedValue({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '', azureApiVersion: null,
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '   ' } }] }))
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })
})
