/**
 * OpenAI 兼容的图片生成 Provider
 *
 * 适用于：
 * - OpenAI DALL-E (dall-e-3, dall-e-2, gpt-image-1.5)
 * - Nano-GPT (hidream, flux-kontext, recraft-v3)
 * - Google Imagen (imagen-4.0, imagen-3.0) - OpenAI 兼容端点
 * - 其他 OpenAI 兼容服务
 */

import { BackendLogger as log } from '../../../utils/logger'
import type { GeneratedImage, ImageGenerationResult, ImageGenerationOptions } from '../types'

// 重新导出类型以保持兼容
export type { GeneratedImage, ImageGenerationResult, ImageGenerationOptions }

export interface OpenAIImageGenerationParams {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  options?: ImageGenerationOptions
}

export class ImageGenerationError extends Error {
  statusCode: number
  
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ImageGenerationError'
    this.statusCode = statusCode
  }
}

/**
 * 使用 OpenAI 兼容 API 生成图片
 * 
 * POST /v1/images/generations
 */
export async function generateImageOpenAI(params: OpenAIImageGenerationParams): Promise<ImageGenerationResult> {
  const { baseUrl, apiKey, model, prompt, options } = params
  
  // 构建请求体
  const body: Record<string, unknown> = {
    model,
    prompt,
    n: options?.n || 1,
    response_format: options?.responseFormat || 'b64_json',
  }
  
  // 可选参数
  if (options?.size) {
    body.size = options.size
  }
  if (options?.quality) {
    body.quality = options.quality
  }
  if (options?.style) {
    body.style = options.style
  }
  
  // Image-to-Image 支持 (Nano-GPT 特有)
  if (options?.inputImage) {
    body.imageDataUrl = options.inputImage
  }
  
  // 确定 API 端点
  // Google Imagen 使用 /v1beta/openai/images/generations
  // 其他使用标准 /v1/images/generations
  const isGoogleImagen = baseUrl.includes('generativelanguage.googleapis.com')
  const endpoint = isGoogleImagen
    ? `${baseUrl.replace(/\/$/, '')}/v1beta/openai/images/generations`
    : `${baseUrl.replace(/\/$/, '')}/v1/images/generations`
  
  log.debug('[ImageGeneration] OpenAI compat request', { endpoint, model, promptLength: prompt.length })
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}`
      log.error('[ImageGeneration] OpenAI compat error', { status: response.status, error: errorMessage })
      throw new ImageGenerationError(errorMessage, response.status)
    }
    
    const data = await response.json() as { data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>; created?: number }
    
    // 解析响应
    const images: GeneratedImage[] = (data.data || []).map((img) => ({
      url: img.url,
      base64: img.b64_json,
      revisedPrompt: img.revised_prompt,
    }))
    
    log.info('[ImageGeneration] OpenAI compat success', { model, imageCount: images.length })
    
    return {
      images,
      model,
      created: data.created || Date.now(),
    }
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      throw error
    }
    log.error('[ImageGeneration] OpenAI compat fetch error', { error: (error as Error).message })
    throw new ImageGenerationError((error as Error).message, 500)
  }
}