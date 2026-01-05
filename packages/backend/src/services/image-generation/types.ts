/**
 * 图片生成服务类型定义
 */

// 生成的图片数据
export interface GeneratedImage {
  url?: string
  base64?: string
  mime?: string
  revisedPrompt?: string
  width?: number
  height?: number
}

// 图片生成结果
export interface ImageGenerationResult {
  images: GeneratedImage[]
  model: string
  created: number
}

// 图片生成选项
export interface ImageGenerationOptions {
  size?: string
  quality?: 'standard' | 'hd'
  style?: 'vivid' | 'natural'
  n?: number
  responseFormat?: 'url' | 'b64_json'
  inputImage?: string
}
