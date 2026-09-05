import { buildRichMessagePayload } from './rich-payload'

describe('buildRichMessagePayload', () => {
  const baseUrl = 'https://chat.example.com'
  const resolveChatImageUrls = (relativePaths: string[], host: string) =>
    relativePaths.map((path) => `${host}${path}`)

  test('returns text-only payload with auto layout', () => {
    const payload = buildRichMessagePayload({
      content: '纯文本回答',
      baseUrl,
      resolveChatImageUrls,
    })

    expect(payload).toEqual({
      layout: 'auto',
      parts: [{ type: 'text', text: '纯文本回答', format: 'markdown' }],
    })
  })

  test('keeps attachment and generated images side-by-side', () => {
    const payload = buildRichMessagePayload({
      content: 'mixed',
      attachmentRelativePaths: ['/img/upload-a.png'],
      generatedImages: [
        {
          url: 'https://cdn.example.com/generated-a.png',
          width: 1024,
          height: 768,
          revisedPrompt: 'generated prompt',
        },
      ],
      baseUrl,
      resolveChatImageUrls,
    })

    expect(payload?.layout).toBe('side-by-side')
    expect(payload?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image',
          source: 'attachment',
          url: 'https://chat.example.com/img/upload-a.png',
        }),
        expect.objectContaining({
          type: 'image',
          source: 'generated',
          url: 'https://cdn.example.com/generated-a.png',
        }),
      ]),
    )
    expect(payload?.parts).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'external' })]),
    )
  })

  test('uses stack layout for image-only payload', () => {
    const payload = buildRichMessagePayload({
      content: '',
      generatedImages: [
        {
          url: 'https://cdn.example.com/generated-a.png',
          width: 1024,
          height: 768,
        },
      ],
      baseUrl,
      resolveChatImageUrls,
    })

    expect(payload?.layout).toBe('stack')
    expect(payload?.parts).toHaveLength(1)
  })
})
