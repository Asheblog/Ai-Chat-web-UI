import {
  VisionProxyService,
  VisionProxyServiceError,
  loadVisionProxyConfig,
  isVisionProxyReady,
  parseStoredImageDescriptions,
  loadHistoryImageDescriptions,
  buildVisionAttachmentHint,
} from '../vision-proxy-service'

const prisma = {
  connectionGroup: { findFirst: jest.fn() },
  connection: { findFirst: jest.fn() },
  message: { findMany: jest.fn() },
} as any

const mockResolvedGroup = (fields: Record<string, unknown>) => {
  prisma.connectionGroup.findFirst.mockResolvedValue({
    id: 1,
    ownerUserId: null,
    displayName: 'test',
    enable: true,
    vendor: fields.vendor ?? null,
    tagsJson: '[]',
    defaultCapabilitiesJson: '{}',
    connectionType: 'external',
    prefixId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    provider: fields.provider,
    baseUrl: fields.baseUrl,
    authType: fields.authType,
    headersJson: fields.headersJson ?? '',
    credentials: [
      {
        id: 10,
        connectionGroupId: 1,
        enable: true,
        secretVaultId: fields.secretVaultId ?? null,
        apiKeyLabel: null,
        modelIdsJson: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  })
  prisma.connection.findFirst.mockResolvedValue(null)
}

const config = {
  enabled: true,
  connectionId: 1,
  modelId: 'qwen-vl-max',
  reasoningEnabled: false,
  reasoningEffort: '',
}
const images = [{ data: 'aGVsbG8=', mime: 'image/png' }]

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as Response

describe('loadVisionProxyConfig', () => {
  it('parses sysMap with env fallback', () => {
    const cfg = loadVisionProxyConfig({ image_transcription_enabled: 'true', image_transcription_connection_id: '3', image_transcription_model_id: 'gpt-4o' })
    expect(cfg).toEqual({
      enabled: true,
      connectionId: 3,
      modelId: 'gpt-4o',
      reasoningEnabled: false,
      reasoningEffort: '',
    })
  })
  it('disabled by default', () => {
    expect(loadVisionProxyConfig({}).enabled).toBe(false)
  })
  it('defaults reasoning fields off / empty', () => {
    const cfg = loadVisionProxyConfig({})
    expect(cfg.reasoningEnabled).toBe(false)
    expect(cfg.reasoningEffort).toBe('')
  })
  it('parses reasoning sysMap keys', () => {
    const cfg = loadVisionProxyConfig({
      image_transcription_reasoning_enabled: 'true',
      image_transcription_reasoning_effort: 'high',
    })
    expect(cfg.reasoningEnabled).toBe(true)
    expect(cfg.reasoningEffort).toBe('high')
  })
  it('allows unset effort value', () => {
    const cfg = loadVisionProxyConfig({ image_transcription_reasoning_effort: 'unset' })
    expect(cfg.reasoningEffort).toBe('unset')
  })
})

describe('isVisionProxyReady', () => {
  it('requires enabled + connectionId + modelId', () => {
    expect(isVisionProxyReady({ ...config, enabled: true, connectionId: 1, modelId: 'm' })).toBe(true)
    expect(isVisionProxyReady({ ...config, enabled: false, connectionId: 1, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ ...config, enabled: true, connectionId: null, modelId: 'm' })).toBe(false)
    expect(isVisionProxyReady({ ...config, enabled: true, connectionId: 1, modelId: null })).toBe(false)
  })
  it('ignores reasoning fields for readiness', () => {
    expect(
      isVisionProxyReady({
        enabled: true,
        connectionId: 1,
        modelId: 'm',
        reasoningEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toBe(true)
  })
})

describe('buildVisionAttachmentHint', () => {
  it('formats count and tool name for positive counts', () => {
    expect(buildVisionAttachmentHint(1)).toContain('本消息含 1 张图片')
    expect(buildVisionAttachmentHint(1)).toContain('analyze_visual_media')
    expect(buildVisionAttachmentHint(3)).toContain('本消息含 3 张图片')
  })

  it('returns empty string for non-positive counts', () => {
    expect(buildVisionAttachmentHint(0)).toBe('')
    expect(buildVisionAttachmentHint(-1)).toBe('')
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
    await expect(
      service().transcribeImages(images, '', {
        ...config,
        enabled: true,
        connectionId: null,
        modelId: null,
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('throws 404 when connection missing', async () => {
    prisma.connectionGroup.findFirst.mockResolvedValue(null); prisma.connection.findFirst.mockResolvedValue(null)
    await expect(service().transcribeImages(images, '', config)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('returns description from openai-format response', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
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

  it('upscales 1x1 png before sending because OpenCode Go / MiMo reject tiny images', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2iQAAAABJRU5ErkJggg=='
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(
      [{ data: tinyPng, mime: 'image/png' }],
      '',
      config,
    )
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    const dataUrl = body.messages[1].content[1].image_url.url as string
    const payload = dataUrl.split(',')[1]
    const buffer = Buffer.from(payload, 'base64')
    expect(buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(buffer.readUInt32BE(16)).toBeGreaterThanOrEqual(32)
    expect(buffer.readUInt32BE(20)).toBeGreaterThanOrEqual(32)
  })

  it('parses google_genai response', async () => {
    mockResolvedGroup({
      provider: 'google_genai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: 'a' }, { text: 'b' }] } }] }))
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)
    expect(result.description).toBe('ab')
  })

  it('builds google_genai generateContent body with inline_data parts', async () => {
    mockResolvedGroup({
      provider: 'google_genai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ candidates: [{ content: { parts: [{ text: 'a' }] } }] }))
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '这是什么？', config)
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toContain(':generateContent')
    const body = JSON.parse(init.body)
    expect(body.contents).toHaveLength(1)
    const parts = body.contents[0].parts
    expect(parts[0].text).toContain('这是什么')
    expect(parts[1].inline_data).toEqual({ mime_type: 'image/png', data: 'aGVsbG8=' })
    // 不应包含 OpenAI 风格的 messages
    expect(body.messages).toBeUndefined()
  })

  it.each(['azure_openai', 'ollama'])('rejects retired provider %s before fetching', async (provider) => {
    mockResolvedGroup({
      provider, baseUrl: 'https://provider.example', authType: 'none', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn()
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toThrow()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('maps http error to 502 VisionProxyServiceError', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' })
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })

  it('includes upstream body snippet in http error message', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Model opencode-go/mimo-v2.5 is not supported"}}',
    })
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringMatching(/HTTP 401.*Model opencode-go\/mimo-v2\.5 is not supported/),
    })
  })

  it('falls back to message.reasoning when content is null', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(
      okResponse({ choices: [{ message: { content: null, reasoning: '  纯红色方块  ' } }] }),
    )
    const result = await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)
    expect(result.description).toBe('纯红色方块')
  })

  it('throws 502 on empty description', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '   ' } }] }))
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config))
      .rejects.toMatchObject({ statusCode: 502 })
  })

  it('includes reasoning_effort on openai body when enabled + effort high', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', {
      ...config,
      reasoningEnabled: true,
      reasoningEffort: 'high',
    })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.reasoning_effort).toBe('high')
  })

  it('omits reasoning_effort when reasoning disabled', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', {
      ...config,
      reasoningEnabled: false,
      reasoningEffort: 'high',
    })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('omits reasoning_effort when effort is unset', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', {
      ...config,
      reasoningEnabled: true,
      reasoningEffort: 'unset',
    })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.reasoning_effort).toBeUndefined()
  })

  it('maps AbortError to 转写模型请求超时', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
    const fetchFn = jest.fn().mockRejectedValue(abort)
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)).rejects.toMatchObject({
      statusCode: 504,
      message: '转写模型请求超时',
    })
  })

  it('maps TimeoutError to 转写模型请求超时', async () => {
    mockResolvedGroup({
      provider: 'openai', baseUrl: 'https://api.example.com/v1', authType: 'bearer', secretVaultId: null,
      headersJson: '',
    })
    const timeout = Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' })
    const fetchFn = jest.fn().mockRejectedValue(timeout)
    await expect(new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', config)).rejects.toMatchObject({
      statusCode: 504,
      message: '转写模型请求超时',
    })
  })

  it('includes thinking enabled for deepseek vendor when reasoningEnabled', async () => {
    mockResolvedGroup({
      provider: 'openai',
      vendor: 'deepseek',
      baseUrl: 'https://api.example.com/v1',
      authType: 'bearer',
      secretVaultId: null,
      headersJson: '',
    })
    const fetchFn = jest.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: 'ok' } }] }))
    await new VisionProxyService({ prisma, fetchFn }).transcribeImages(images, '', {
      ...config,
      reasoningEnabled: true,
    })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body.thinking).toEqual({ type: 'enabled' })
  })
})
