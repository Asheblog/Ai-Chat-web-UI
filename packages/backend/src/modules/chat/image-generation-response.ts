/**
 * 生图模型响应处理
 *
 * 当检测到用户选择的模型是生图模型时，使用此函数处理请求
 * 返回 SSE 流式响应，包含生成的图片
 */

import { BackendLogger as log } from '../../utils/logger'
import { prisma } from '../../db'
import { imageGenerationService, ImageGenerationError, type ImageGenerationResult, type GeneratedImage } from '../../services/image-generation'
import type { UsageQuotaSnapshot, Message } from '../../types'
import { serializeQuotaSnapshot } from '../../utils/quota'
import { parseCapabilityEnvelope } from '../../utils/capabilities'

export interface ImageGenerationResponseParams {
  sessionId: number
  content: string  // 用户的生图 prompt
  connection: {
    id: number
    baseUrl: string
    apiKey?: string | null
    provider: string
  }
  modelRawId: string
  sseHeaders: Record<string, string>
  quotaSnapshot: UsageQuotaSnapshot | null
  userMessageRecord: Message | null
  assistantMessageId: number | null
  assistantClientMessageId: string | null
  actorIdentifier: string
}

/**
 * 创建生图响应的 SSE 流
 */
export async function createImageGenerationResponse(
  params: ImageGenerationResponseParams
): Promise<Response> {
  const {
    sessionId,
    content,
    connection,
    modelRawId,
    sseHeaders,
    quotaSnapshot,
    assistantMessageId,
    assistantClientMessageId,
    actorIdentifier,
  } = params

  log.info('[ImageGenerationResponse] Starting image generation', {
    sessionId,
    model: modelRawId,
    promptLength: content.length,
  })

  // 创建 SSE 流
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    async start(controller) {
      const sendSSE = (event: string, data: unknown) => {
        const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        controller.enqueue(encoder.encode(line))
      }

      try {
        // 发送 start 事件
        sendSSE('message', {
          type: 'start',
          messageId: assistantMessageId,
          assistantMessageId,
          assistantClientMessageId,
        })

        // 调用生图服务
        const result: ImageGenerationResult = await imageGenerationService.generate(
          {
            id: connection.id,
            baseUrl: connection.baseUrl,
            apiKey: connection.apiKey || undefined,
            provider: connection.provider,
          },
          modelRawId,
          content
        )

        log.info('[ImageGenerationResponse] Generation complete', {
          sessionId,
          imageCount: result.images.length,
        })

        // 发送 image 事件
        sendSSE('message', {
          type: 'image',
          generatedImages: result.images.map((img: GeneratedImage) => ({
            url: img.url,
            base64: img.base64,
            mime: img.mime,
            revisedPrompt: img.revisedPrompt,
          })),
          messageId: assistantMessageId,
        })

        // 发送 complete 事件
        sendSSE('message', {
          type: 'complete',
          messageId: assistantMessageId,
          assistantMessageId,
          assistantClientMessageId,
          done: true,
          quota: quotaSnapshot ? serializeQuotaSnapshot(quotaSnapshot) : undefined,
        })

        controller.close()
      } catch (error) {
        log.error('[ImageGenerationResponse] Generation failed', {
          sessionId,
          error: (error as Error).message,
        })

        // 发送 error 事件
        const errorMessage = error instanceof ImageGenerationError
          ? (error as ImageGenerationError).message
          : 'Image generation failed'
        
        sendSSE('message', {
          type: 'error',
          error: errorMessage,
          messageId: assistantMessageId,
        })

        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: sseHeaders,
  })
}

/**
 * 判断模型是否为生图模型
 * 基于 ModelCatalog 表中的 capabilities.image_generation 配置
 *
 * @param connectionId 连接 ID
 * @param modelRawId 模型原始 ID
 * @returns 是否为生图模型
 */
export async function checkImageGenerationCapability(
  connectionId: number,
  modelRawId: string
): Promise<boolean> {
  if (!connectionId || !modelRawId) {
    return false
  }
  
  try {
    // 查询 catalog 中的 capabilities
    const catalog = await prisma.modelCatalog.findFirst({
      where: {
        connectionId,
        rawId: modelRawId,
      },
      select: {
        capabilitiesJson: true,
      },
    })
    
    if (!catalog?.capabilitiesJson) {
      return false
    }
    
    const envelope = parseCapabilityEnvelope(catalog.capabilitiesJson)
    return envelope?.flags?.image_generation === true
  } catch (error) {
    log.warn('[checkImageGenerationCapability] Failed to query catalog', {
      connectionId,
      modelRawId,
      error: error instanceof Error ? error.message : error,
    })
    return false
  }
}