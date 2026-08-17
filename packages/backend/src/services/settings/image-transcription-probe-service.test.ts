import { ImageTranscriptionProbeService } from './image-transcription-probe-service'
import type { VisionProxyService } from '../../modules/chat/services/vision-proxy-service'

const createPrismaMock = (settings: Record<string, string>) =>
  ({
    systemSetting: {
      findMany: jest.fn().mockResolvedValue(
        Object.entries(settings).map(([key, value]) => ({ key, value })),
      ),
    },
  }) as any

const readySettings = {
  image_transcription_enabled: 'true',
  image_transcription_connection_id: '7',
  image_transcription_model_id: 'vision-test',
}

const createVisionProxyMock = (): jest.Mocked<Pick<VisionProxyService, 'transcribeImages'>> => ({
  transcribeImages: jest.fn(),
})

describe('ImageTranscriptionProbeService', () => {
  it('reports successful transcription and relevance checks', async () => {
    const visionProxy = createVisionProxyMock()
    visionProxy.transcribeImages
      .mockResolvedValueOnce({ description: '一张测试图片', modelRawId: 'vision-test' })
      .mockResolvedValueOnce({
        description: '{"relevance":"related","description":"与测试上下文相关"}',
        modelRawId: 'vision-test',
      })
    const service = new ImageTranscriptionProbeService({
      prisma: createPrismaMock(readySettings),
      visionProxy: visionProxy as unknown as VisionProxyService,
    })

    const result = await service.probe()

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        steps: [
          expect.objectContaining({ name: 'transcribe', ok: true, detail: '一张测试图片' }),
          expect.objectContaining({ name: 'relevance', ok: true, detail: 'related：与测试上下文相关' }),
        ],
      }),
    )
    expect(visionProxy.transcribeImages).toHaveBeenCalledTimes(2)
    expect(visionProxy.transcribeImages).toHaveBeenLastCalledWith(
      [expect.objectContaining({ mime: 'image/png' })],
      expect.stringContaining('探针上下文：一张测试图片'),
      expect.objectContaining({ connectionId: 7, modelId: 'vision-test' }),
    )
  })

  it('stops after transcription fails and exposes the original error', async () => {
    const visionProxy = createVisionProxyMock()
    visionProxy.transcribeImages.mockRejectedValueOnce(new Error('转写模型请求失败（HTTP 502）'))
    const service = new ImageTranscriptionProbeService({
      prisma: createPrismaMock(readySettings),
      visionProxy: visionProxy as unknown as VisionProxyService,
    })

    const result = await service.probe()

    expect(result).toEqual({
      ok: false,
      steps: [
        expect.objectContaining({
          name: 'transcribe',
          ok: false,
          error: '转写模型请求失败（HTTP 502）',
        }),
      ],
    })
    expect(visionProxy.transcribeImages).toHaveBeenCalledTimes(1)
  })

  it('returns a structured failed step when the proxy is not configured', async () => {
    const visionProxy = createVisionProxyMock()
    const service = new ImageTranscriptionProbeService({
      prisma: createPrismaMock({ image_transcription_enabled: 'false' }),
      visionProxy: visionProxy as unknown as VisionProxyService,
    })

    await expect(service.probe()).resolves.toEqual({
      ok: false,
      steps: [
        {
          name: 'transcribe',
          ok: false,
          durationMs: 0,
          error: '图片转写代理未配置（请管理员在系统设置中配置转写模型）',
        },
      ],
    })
    expect(visionProxy.transcribeImages).not.toHaveBeenCalled()
  })

  it('returns configuration loading failures as a structured transcribe step', async () => {
    const visionProxy = createVisionProxyMock()
    const prisma = createPrismaMock({})
    prisma.systemSetting.findMany.mockRejectedValueOnce(new Error('系统设置读取失败'))
    const service = new ImageTranscriptionProbeService({
      prisma,
      visionProxy: visionProxy as unknown as VisionProxyService,
    })

    await expect(service.probe()).resolves.toEqual({
      ok: false,
      steps: [
        expect.objectContaining({
          name: 'transcribe',
          ok: false,
          error: '系统设置读取失败',
        }),
      ],
    })
  })

  it('redacts supplied image data from probe details and errors', async () => {
    const imageBase64 = 'c2VjcmV0LWltYWdl'
    const visionProxy = createVisionProxyMock()
    visionProxy.transcribeImages
      .mockResolvedValueOnce({ description: `图片数据 ${imageBase64}`, modelRawId: 'vision-test' })
      .mockRejectedValueOnce(new Error(`模型错误 data:image/png;base64,${imageBase64}`))
    const service = new ImageTranscriptionProbeService({
      prisma: createPrismaMock(readySettings),
      visionProxy: visionProxy as unknown as VisionProxyService,
    })

    const result = await service.probe({ imageBase64, mime: 'image/png' })

    expect(JSON.stringify(result)).not.toContain(imageBase64)
    expect(result.steps).toEqual([
      expect.objectContaining({ detail: '图片数据 [redacted image]' }),
      expect.objectContaining({ error: '模型错误 [redacted image]' }),
    ])
  })
})
