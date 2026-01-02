/**
 * Gemini GenerateContent 图片生成 Provider
 * 
 * 适用于：
 * - gemini-2.5-flash-image (Nano Banana 风格)
 * 
 * 这种模式下，图片通过聊天 API 的响应返回，
 * 而不是通过专门的 /images/generations 端点
 */

import { BackendLogger as log } from '../../../utils/logger'
import type { GeneratedImage, ImageGenerationResult } from './openai-compat'

export interface GeminiImageGenerationParams {
  apiKey: string
  model: string
  prompt: string
  inputImage?: string  // base64 data URL for image-to-image
}

/**
 * 使用 Gemini GenerateContent API 生成图片
 * 
 * POST /v1beta/models/{model}:generateContent
 */
export async function generateImageGemini(params: GeminiImageGenerationParams): Promise<ImageGenerationResult> {
  const { apiKey, model, prompt, inputImage } = params
  
  // 构建 parts 数组
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
  
  // Image-to-Image: 先放输入图片
  if (inputImage) {
    const dataUrlMatch = inputImage.match(/^data:([^;]+);base64,(.+)$/)
    if (dataUrlMatch) {
      const [, mimeType, base64Data] = dataUrlMatch
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/png',
          data: base64Data,
        },
      })
    } else {
      // 如果不是 data URL，假设是纯 base64
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: inputImage,
        },
      })
    }
  }
  
  // 文本提示
  parts.push({ text: prompt })
  
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  
  log.debug('[ImageGeneration] Gemini request', { endpoint, model, promptLength: prompt.length, hasInputImage: !!inputImage })
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts, role: 'user' }],
      }),
    })
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } }
      const errorMessage = errorData?.error?.message || `HTTP ${response.status}`
      log.error('[ImageGeneration] Gemini error', { status: response.status, error: errorMessage })
      throw new GeminiImageGenerationError(errorMessage, response.status)
    }
    
    interface GeminiPart {
      text?: string
      inlineData?: {
        mimeType: string
        data: string
      }
    }
    
    interface GeminiResponse {
      candidates?: Array<{
        content?: {
          parts?: GeminiPart[]
        }
      }>
    }
    
    const data = await response.json() as GeminiResponse
    const images: GeneratedImage[] = []
    
    // 从响应中提取图片
    const responseParts = data.candidates?.[0]?.content?.parts || []
    for (const part of responseParts) {
      if (part.inlineData) {
        images.push({
          base64: part.inlineData.data,
          mime: part.inlineData.mimeType,
        })
      }
    }
    
    log.info('[ImageGeneration] Gemini success', { model, imageCount: images.length })
    
    return {
      images,
      model,
      created: Date.now(),
    }
  } catch (error) {
    if (error instanceof GeminiImageGenerationError) {
      throw error
    }
    log.error('[ImageGeneration] Gemini fetch error', { error: (error as Error).message })
    throw new GeminiImageGenerationError((error as Error).message, 500)
  }
}

export class GeminiImageGenerationError extends Error {
  statusCode: number
  
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'GeminiImageGenerationError'
    this.statusCode = statusCode
  }
}