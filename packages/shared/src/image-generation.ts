/**
 * AI 生成图片相关类型定义
 */

// 生成的图片数据
export interface GeneratedImage {
  url?: string;           // 图片 URL（云端存储）
  base64?: string;        // Base64 数据
  mime?: string;          // MIME 类型 (image/png, image/jpeg 等)
  revisedPrompt?: string; // 模型修正后的提示词 (DALL-E 特有)
  width?: number;
  height?: number;
}

// 图片生成请求选项
export interface ImageGenerationOptions {
  size?: '256x256' | '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
  responseFormat?: 'url' | 'b64_json';
  // Image-to-Image 选项 (Gemini/Nano-GPT)
  inputImage?: string;    // base64 data URL
}

// 图片生成结果
export interface ImageGenerationResult {
  images: GeneratedImage[];
  model: string;
  created: number;
}

// 支持的生图 API 类型
export type ImageGenerationApiType = 'openai-compat' | 'gemini-generate';

// 生图模型识别模式
export const IMAGE_GENERATION_MODEL_PATTERNS = [
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
] as const;

/**
 * 判断模型是否为生图模型
 */
export function isImageGenerationModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase();
  return IMAGE_GENERATION_MODEL_PATTERNS.some(pattern => lowerId.includes(pattern));
}

/**
 * 判断模型使用哪种生图 API
 * 根据 provider 和模型名称综合判断
 */
export function getImageGenerationApiType(modelId: string, provider?: string): ImageGenerationApiType | null {
  const lowerId = modelId.toLowerCase();
  
  // 如果 provider 是 OpenAI 兼容类型，使用 openai-compat API
  // 这包括通过第三方代理（如 CLIProxyAPI）转发的 Gemini 模型
  if (provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai') {
    return 'openai-compat';
  }
  
  // 如果是原生 Google GenAI 连接且模型名包含 gemini 和 image，使用 gemini-generate
  if (provider === 'google_genai' && lowerId.includes('gemini') && lowerId.includes('image')) {
    return 'gemini-generate';
  }
  
  // 其他生图模型使用 OpenAI 兼容 API
  if (isImageGenerationModel(modelId)) {
    return 'openai-compat';
  }
  
  return null;
}