import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import type { SecretVaultService } from '../../../services/secret-vault'
import { buildHeaders, type ProviderType, type AuthType } from '../../../utils/providers'
import { convertChatCompletionsRequestToResponses, extractTextFromResponsesResponse } from '../../../utils/openai-responses'
import { BackendLogger as log } from '../../../utils/logger'

export interface VisionProxyConfig {
  enabled: boolean
  connectionId: number | null
  modelId: string | null
}

export interface ImageDescription {
  description: string
  modelRawId: string
}

export class VisionProxyServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'VisionProxyServiceError'
    this.statusCode = statusCode
  }
}

const TRANSCRIPTION_SYSTEM_PROMPT =
  '你是一个图片描述助手。请尽可能详细地描述图片内容，包括：主要物体/人物、可见的文字内容（保留原文）、颜色、布局、数量、场景与氛围等一切可见细节。如有多个图片请分别说明。只输出描述文本，不要使用 Markdown 格式。'

export function loadVisionProxyConfig(sysMap: Record<string, string>): VisionProxyConfig {
  const enabled = (sysMap.image_transcription_enabled ?? process.env.IMAGE_TRANSCRIPTION_ENABLED ?? 'false')
    .toString()
    .toLowerCase() === 'true'
  const connectionIdRaw = sysMap.image_transcription_connection_id ?? process.env.IMAGE_TRANSCRIPTION_CONNECTION_ID ?? ''
  const connectionId = connectionIdRaw ? Number(connectionIdRaw) || null : null
  const modelIdRaw = sysMap.image_transcription_model_id ?? process.env.IMAGE_TRANSCRIPTION_MODEL_ID ?? ''
  const modelId = modelIdRaw ? modelIdRaw.toString().trim() || null : null
  return { enabled, connectionId, modelId }
}

export function isVisionProxyReady(config: VisionProxyConfig): boolean {
  return config.enabled && config.connectionId != null && Boolean(config.modelId)
}

/**
 * 工具流下注入给主模型的附件提醒：图已剥离，需调用 analyze_visual_media。
 * 仅在 count > 0 时返回非空文案。
 */
export function buildVisionAttachmentHint(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  const n = Math.floor(count)
  return `[用户附件] 本消息含 ${n} 张图片。你无法直接看到图片，请先调用 analyze_visual_media 查看后再回答。`
}

export function parseStoredImageDescriptions(json: string | null | undefined): ImageDescription[] | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

export async function loadHistoryImageDescriptions(
  prisma: PrismaClient,
  sessionId: number,
  historyUpperBound: Date | null,
): Promise<Map<number, ImageDescription[]>> {
  const rows = await prisma.message.findMany({
    where: {
      sessionId,
      role: 'user',
      imageDescriptionsJson: { not: null },
      ...(historyUpperBound ? { createdAt: { lte: historyUpperBound } } : {}),
    },
    select: { id: true, imageDescriptionsJson: true },
  })
  const result = new Map<number, ImageDescription[]>()
  for (const row of rows) {
    const parsed = parseStoredImageDescriptions(row.imageDescriptionsJson)
    if (parsed) {
      result.set(row.id, parsed)
    }
  }
  return result
}

export interface VisionProxyServiceDeps {
  prisma?: PrismaClient
  secretVault?: SecretVaultService
  fetchFn?: typeof fetch
}

export class VisionProxyService {
  private prisma: PrismaClient
  private secretVault?: SecretVaultService
  private fetchFn: typeof fetch

  constructor(deps: VisionProxyServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.secretVault = deps.secretVault
    this.fetchFn = deps.fetchFn ?? fetch
  }

  /**
   * 调用指定 vision 模型转写图片为文字描述（直连模式，参考 title-summary-service）
   */
  async transcribeImages(
    images: Array<{ data: string; mime: string }>,
    question: string,
    config: VisionProxyConfig,
  ): Promise<{ description: string; modelRawId: string }> {
    if (!isVisionProxyReady(config)) {
      throw new VisionProxyServiceError('图片转写代理未配置（请管理员在系统设置中配置转写模型）', 400)
    }
    if (!Array.isArray(images) || images.length === 0) {
      throw new VisionProxyServiceError('没有可转写的图片', 400)
    }
    const connection = await this.prisma.connection.findUnique({
      where: { id: config.connectionId! },
    })
    if (!connection) {
      throw new VisionProxyServiceError('图片转写代理的连接不存在，请检查系统设置', 404)
    }
    const modelId = config.modelId!
    const provider = connection.provider as ProviderType
    const endpoint = (connection.baseUrl || '').trim().replace(/\/+$/, '')
    const authType = connection.authType as AuthType
    let apiKey = ''
    if (authType === 'bearer' && (connection as any).secretVaultId && this.secretVault) {
      apiKey = await this.secretVault.decryptById((connection as any).secretVaultId).catch(() => {
        throw new VisionProxyServiceError('图片转写代理的 API Key 解密失败', 502)
      })
    }
    if (!endpoint) {
      throw new VisionProxyServiceError('图片转写代理的连接未配置 baseUrl', 400)
    }

    let extraHeaders: Record<string, string> | undefined
    try {
      if (connection.headersJson && connection.headersJson.trim()) {
        extraHeaders = JSON.parse(connection.headersJson)
      }
    } catch {
      // ignore invalid JSON
    }

    const userText = `请描述以上图片。${question?.trim() ? `\n用户问题：${question.trim()}` : ''}`
    const parts: Array<Record<string, unknown>> = [{ type: 'text', text: userText }]
    for (const image of images) {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${image.mime};base64,${image.data}` },
      })
    }
    const messages = [
      { role: 'system', content: TRANSCRIPTION_SYSTEM_PROMPT },
      { role: 'user', content: parts },
    ]
    const chatBody: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: 0.2,
      max_tokens: 2000,
      stream: false,
    }
    // F6: 各 provider 请求体格式差异在此收敛，openai/azure_openai/openai_responses 保持原样
    let body: Record<string, unknown>
    if (provider === 'google_genai') {
      // Gemini generateContent 多模态格式：contents[].parts 内混排 text 与 inline_data
      const geminiParts: Array<Record<string, unknown>> = [{ text: userText }]
      for (const image of images) {
        geminiParts.push({
          inline_data: { mime_type: image.mime, data: image.data },
        })
      }
      body = {
        contents: [
          {
            role: 'user',
            parts: geminiParts,
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2000,
        },
      }
    } else if (provider === 'ollama') {
      // Ollama /api/chat 多模态格式：messages[].images 为 base64 数组
      body = {
        model: modelId,
        messages: [
          { role: 'system', content: TRANSCRIPTION_SYSTEM_PROMPT },
          {
            role: 'user',
            content: userText,
            images: images.map((image) => image.data),
          },
        ],
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 2000,
        },
      }
    } else {
      body = provider === 'openai_responses' ? convertChatCompletionsRequestToResponses(chatBody) : chatBody
    }
    const headers = await buildHeaders(provider, authType, apiKey, extraHeaders)

    let url: string
    if (provider === 'ollama') {
      url = `${endpoint}/api/chat`
    } else if (provider === 'azure_openai') {
      const apiVersion = connection.azureApiVersion || '2024-02-15-preview'
      url = `${endpoint}/openai/deployments/${encodeURIComponent(modelId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    } else if (provider === 'openai_responses') {
      url = `${endpoint}/responses`
    } else if (provider === 'google_genai') {
      url = `${endpoint}/models/${encodeURIComponent(modelId)}:generateContent`
    } else {
      url = `${endpoint}/chat/completions`
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        log.warn('[vision-proxy] provider request failed', {
          status: response.status,
          url,
          error: errorText.slice(0, 200),
        })
        throw new VisionProxyServiceError(`转写模型请求失败（HTTP ${response.status}）`, 502)
      }
      const rawText = await response.text()
      let json: any = {}
      try {
        json = JSON.parse(rawText)
      } catch {
        // ignore parse error
      }
      let text = ''
      if (provider === 'openai_responses') {
        text = extractTextFromResponsesResponse(json) || ''
      } else if (provider === 'google_genai') {
        text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
      } else {
        text =
          json?.choices?.[0]?.message?.content ||
          json?.choices?.[0]?.message?.reasoning_content ||
          json?.message?.content ||
          ''
      }
      text = text.trim()
      if (!text) {
        throw new VisionProxyServiceError('转写模型返回了空描述', 502)
      }
      log.info('[vision-proxy] transcription completed', {
        images: images.length,
        modelRawId: modelId,
        descriptionLength: text.length,
      })
      return { description: text, modelRawId: modelId }
    } catch (error) {
      if (error instanceof VisionProxyServiceError) {
        throw error
      }
      log.error('[vision-proxy] unexpected error', { error })
      throw new VisionProxyServiceError(
        `图片转写失败：${error instanceof Error ? error.message : String(error)}`,
        502,
      )
    }
  }
}
