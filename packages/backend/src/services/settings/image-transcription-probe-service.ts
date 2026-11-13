import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  isVisionProxyReady,
  loadVisionProxyConfig,
  type VisionProxyService,
} from '../vision/vision-proxy-service'
import { BUILT_IN_PROBE_IMAGE_BASE64, BUILT_IN_PROBE_IMAGE_MIME } from './vision-probe-image'

// 图片相关性解析：探针专用（原 utils/web-image-evidence 的唯一残留消费方）
type ProbeImageRelevance = 'related' | 'weakly_related' | 'unrelated'

const RELEVANCE_PROMPT = `判断这张图片与给定新闻/页面上下文是否相关。
只输出一行 JSON，格式：{"relevance":"related|weakly_related|unrelated","description":"一句话描述图片内容"}
规则：
- related：图片直接表现新闻主体、现场、人物、图表结论
- weakly_related：配图有一定关联（如数据图、城市远景）但非核心
- unrelated：广告、站点 logo、社交分享按钮、无关行情图、装饰图
上下文：`

const parseImageRelevance = (
  raw: string,
): { relevance: ProbeImageRelevance; description: string } => {
  const text = (raw || '').trim()
  if (!text) {
    return { relevance: 'unrelated', description: '' }
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        relevance?: unknown
        related?: unknown
        description?: unknown
        summary?: unknown
      }
      const description =
        (typeof parsed.description === 'string' && parsed.description.trim()) ||
        (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
        text
      const relevanceRaw = String(parsed.relevance ?? parsed.related ?? '')
        .trim()
        .toLowerCase()
      if (
        relevanceRaw === 'related' ||
        relevanceRaw === 'relevant' ||
        relevanceRaw === '相关' ||
        relevanceRaw === 'true'
      ) {
        return { relevance: 'related', description }
      }
      if (
        relevanceRaw === 'weakly_related' ||
        relevanceRaw === 'weak' ||
        relevanceRaw === 'partial' ||
        relevanceRaw === '弱相关'
      ) {
        return { relevance: 'weakly_related', description }
      }
      if (
        relevanceRaw === 'unrelated' ||
        relevanceRaw === 'irrelevant' ||
        relevanceRaw === '无关' ||
        relevanceRaw === 'false'
      ) {
        return { relevance: 'unrelated', description }
      }
    } catch {
      // fall through to heuristic
    }
  }

  const lower = text.toLowerCase()
  if (/无关|不相关|irrelevant|unrelated|not related|no relation/.test(lower)) {
    return { relevance: 'unrelated', description: text }
  }
  if (/弱相关|部分相关|weakly|partially related|somewhat related/.test(lower)) {
    return { relevance: 'weakly_related', description: text }
  }
  if (/相关|relevant|related/.test(lower)) {
    return { relevance: 'related', description: text }
  }
  return { relevance: 'unrelated', description: text }
}

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

/** Stay under typical reverse-proxy 60s; two probe calls run in parallel. */
export const PROBE_STEP_TIMEOUT_MS = 40_000

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
    const probeConfig = {
      ...config,
      reasoningEnabled: false,
    }

    // Connectivity check only: admin reasoning/high effort can take >60s and get cut by OpenResty.
    const transcribePromise = this.runStep('transcribe', imageBase64, async () => {
      const result = await this.visionProxy.transcribeImages(
        [image],
        '探针：请简要描述图片。',
        probeConfig,
        { timeoutMs: PROBE_STEP_TIMEOUT_MS },
      )
      return redactImageData(result.description, imageBase64)
    })
    const relevancePromise = this.runStep('relevance', imageBase64, async () => {
      const result = await this.visionProxy.transcribeImages(
        [image],
        `${RELEVANCE_PROMPT}探针上下文：一张测试图片`,
        probeConfig,
        { timeoutMs: PROBE_STEP_TIMEOUT_MS },
      )
      const parsed = parseImageRelevance(result.description)
      return redactImageData(`${parsed.relevance}：${parsed.description}`, imageBase64)
    })

    const steps = await Promise.all([transcribePromise, relevancePromise])
    return { ok: steps.every((step) => step.ok), steps }
  }

  private async runStep(
    name: ProbeStepName,
    imageBase64: string,
    work: () => Promise<string>,
  ): Promise<ProbeStep> {
    const startedAt = this.now()
    try {
      const detail = await work()
      return { name, ok: true, durationMs: toDurationMs(startedAt, this.now), detail }
    } catch (error) {
      return {
        name,
        ok: false,
        durationMs: toDurationMs(startedAt, this.now),
        error: safeErrorMessage(error, imageBase64),
      }
    }
  }
}
