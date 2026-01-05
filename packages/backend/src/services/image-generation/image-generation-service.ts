/**
 * 图片生成服务
 *
 * 统一管理 OpenAI 兼容和 Gemini GenerateContent 两种图片生成 API
 *
 * 注意：模型是否为生图模型由 ModelCatalog 的 capabilities.image_generation 决定，
 * 本服务只负责根据 provider 选择合适的 API 进行调用。
 */

import { BackendLogger as log } from '../../utils/logger'
import {
  generateImageOpenAI,
  ImageGenerationError,
} from './providers/openai-compat'
import { generateImageGemini, GeminiImageGenerationError } from './providers/gemini-generate'
import type { ImageGenerationResult, ImageGenerationOptions } from './types'

export type ImageGenerationApiType = 'openai-compat' | 'gemini-generate'

export interface ImageGenerationServiceDeps {
  logger?: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>
}

export interface ConnectionInfo {
  id: number
  baseUrl: string
  apiKey?: string
  provider: string
}

export class ImageGenerationService {
  private logger: Pick<typeof console, 'debug' | 'info' | 'warn' | 'error'>

  constructor(deps: ImageGenerationServiceDeps = {}) {
    this.logger = deps.logger ?? log
  }

  /**
   * 根据 provider 判断使用哪种生图 API
   */
  getApiType(modelId: string, provider?: string): ImageGenerationApiType {
    const lowerId = modelId.toLowerCase()
    
    // 如果是原生 Google GenAI 连接且模型名包含 gemini，使用 gemini-generate API
    if (provider === 'google_genai' && lowerId.includes('gemini')) {
      return 'gemini-generate'
    }
    
    // 其他所有情况使用 OpenAI 兼容 API
    // 包括：OpenAI、Azure OpenAI、第三方代理（如 CLIProxyAPI）、Nano-GPT 等
    return 'openai-compat'
  }

  /**
   * 生成图片
   */
  async generate(
    connection: ConnectionInfo,
    modelId: string,
    prompt: string,
    options?: ImageGenerationOptions
  ): Promise<ImageGenerationResult> {
    const apiType = this.getApiType(modelId, connection.provider)
    
    this.logger.info('[ImageGenerationService] Generating image', {
      connectionId: connection.id,
      model: modelId,
      apiType,
      promptLength: prompt.length,
    })
    
    try {
      if (apiType === 'gemini-generate') {
        return await generateImageGemini({
          apiKey: connection.apiKey || '',
          model: modelId,
          prompt,
          inputImage: options?.inputImage,
        })
      }
      
      // OpenAI 兼容 API
      return await generateImageOpenAI({
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey || '',
        model: modelId,
        prompt,
        options,
      })
    } catch (error) {
      this.logger.error('[ImageGenerationService] Generation failed', {
        connectionId: connection.id,
        model: modelId,
        error: (error as Error).message,
      })
      throw error
    }
  }
}

// 默认实例
let imageGenerationService = new ImageGenerationService()

export const setImageGenerationService = (service: ImageGenerationService) => {
  imageGenerationService = service
}

export { imageGenerationService }
export { ImageGenerationError, GeminiImageGenerationError }
export type { ImageGenerationResult, ImageGenerationOptions }