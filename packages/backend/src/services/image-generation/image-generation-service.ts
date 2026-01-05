/**
 * 图片生成服务
 * 
 * 统一管理 OpenAI 兼容和 Gemini GenerateContent 两种图片生成 API
 */

import { BackendLogger as log } from '../../utils/logger'
import {
  generateImageOpenAI,
  type ImageGenerationResult,
  type ImageGenerationOptions,
  ImageGenerationError,
} from './providers/openai-compat'
import { generateImageGemini, GeminiImageGenerationError } from './providers/gemini-generate'

// 生图模型识别模式
const IMAGE_GENERATION_MODEL_PATTERNS = [
  // OpenAI
  'dall-e',
  'gpt-image',
  // Google
  'imagen',
  'gemini-2.5-flash-image',
  // Nano-GPT / 其他
  'hidream',
  'flux',
  'recraft',
  'sdxl',
  'midjourney',
  'stable-diffusion',
]

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
   * 判断模型是否为生图模型
   */
  isImageGenerationModel(modelId: string): boolean {
    const lowerId = modelId.toLowerCase()
    return IMAGE_GENERATION_MODEL_PATTERNS.some(pattern => lowerId.includes(pattern))
  }

  /**
   * 判断模型使用哪种生图 API
   * 根据 provider 和模型名称综合判断
   */
  getApiType(modelId: string, provider?: string): ImageGenerationApiType | null {
    const lowerId = modelId.toLowerCase()
    
    // 如果 provider 是 OpenAI 兼容类型，使用 openai-compat API
    // 这包括通过第三方代理（如 CLIProxyAPI）转发的 Gemini 模型
    if (provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai') {
      return 'openai-compat'
    }
    
    // 如果是原生 Google GenAI 连接且模型名包含 gemini 和 image，使用 gemini-generate
    if (provider === 'google_genai' && lowerId.includes('gemini') && lowerId.includes('image')) {
      return 'gemini-generate'
    }
    
    // 其他生图模型使用 OpenAI 兼容 API
    if (this.isImageGenerationModel(modelId)) {
      return 'openai-compat'
    }
    
    return null
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
    
    if (!apiType) {
      throw new ImageGenerationError(`Model ${modelId} is not an image generation model`, 400)
    }
    
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