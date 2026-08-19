import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  isVisionProxyReady,
  loadVisionProxyConfig,
  type VisionProxyService,
} from '../../modules/chat/services/vision-proxy-service'
import { parseImageRelevance, RELEVANCE_PROMPT } from '../../utils/web-image-evidence'
import { BUILT_IN_PROBE_IMAGE_BASE64, BUILT_IN_PROBE_IMAGE_MIME } from './vision-probe-image'

export type ProbeStepName = 'transcribe' | 'relevance'

export type ProbeStep = {
  name: ProbeStepName
  ok: boolean
  durationMs: number
  detail?: string
  error?: string
}

export type ProbeResult = {
  ok: boolean
  steps: ProbeStep[]
}

export interface ImageTranscriptionProbeServiceDeps {
  prisma?: PrismaClient
  visionProxy: VisionProxyService
  now?: () => number
}

const toDurationMs = (startedAt: number, now: () => number): number =>
  Math.max(0, Math.round(now() - startedAt))

const redactImageData = (value: string, imageBase64: string): string => {
  const withoutDataUri = value.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, '[redacted image]')
  return imageBase64 ? withoutDataUri.replaceAll(imageBase64, '[redacted image]') : withoutDataUri
}

const safeErrorMessage = (error: unknown, imageBase64: string): string => {
  const message = error instanceof Error ? error.message : String(error)
  return redactImageData(message, imageBase64)
}

export class ImageTranscriptionProbeService {
  private prisma: PrismaClient
  private visionProxy: VisionProxyService
  private now: () => number

  constructor(deps: ImageTranscriptionProbeServiceDeps) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.visionProxy = deps.visionProxy
    this.now = deps.now ?? Date.now
  }

  async probe(options: { imageBase64?: string; mime?: string } = {}): Promise<ProbeResult> {
    let config
    const settingsLoadStartedAt = this.now()
    try {
      const rows = await this.prisma.systemSetting.findMany({
        select: { key: true, value: true },
      })
      config = loadVisionProxyConfig(Object.fromEntries(rows.map((row) => [row.key, row.value])))
    } catch (error) {
      return {
        ok: false,
        steps: [
          {
            name: 'transcribe',
            ok: false,
            durationMs: toDurationMs(settingsLoadStartedAt, this.now),
            error: safeErrorMessage(error, ''),
          },
        ],
      }
    }
    if (!isVisionProxyReady(config)) {
      return {
        ok: false,
        steps: [
          {
            name: 'transcribe',
            ok: false,
            durationMs: 0,
            error: '图片转写代理未配置（请管理员在系统设置中配置转写模型）',
          },
        ],
      }
    }

    const imageBase64 = options.imageBase64 ?? BUILT_IN_PROBE_IMAGE_BASE64
    const mime = options.mime ?? BUILT_IN_PROBE_IMAGE_MIME
    const image = { data: imageBase64, mime }
    const steps: ProbeStep[] = []

    const transcribeStartedAt = this.now()
    try {
      const result = await this.visionProxy.transcribeImages(
        [image],
        '探针：请简要描述图片。',
        config,
      )
      steps.push({
        name: 'transcribe',
        ok: true,
        durationMs: toDurationMs(transcribeStartedAt, this.now),
        detail: redactImageData(result.description, imageBase64),
      })
    } catch (error) {
      steps.push({
        name: 'transcribe',
        ok: false,
        durationMs: toDurationMs(transcribeStartedAt, this.now),
        error: safeErrorMessage(error, imageBase64),
      })
      return { ok: false, steps }
    }

    const relevanceStartedAt = this.now()
    try {
      const result = await this.visionProxy.transcribeImages(
        [image],
        `${RELEVANCE_PROMPT}探针上下文：一张测试图片`,
        config,
      )
      const parsed = parseImageRelevance(result.description)
      steps.push({
        name: 'relevance',
        ok: true,
        durationMs: toDurationMs(relevanceStartedAt, this.now),
        detail: redactImageData(`${parsed.relevance}：${parsed.description}`, imageBase64),
      })
    } catch (error) {
      steps.push({
        name: 'relevance',
        ok: false,
        durationMs: toDurationMs(relevanceStartedAt, this.now),
        error: safeErrorMessage(error, imageBase64),
      })
    }

    return { ok: steps.every((step) => step.ok), steps }
  }
}
