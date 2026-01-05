export {
  ImageGenerationService,
  imageGenerationService,
  setImageGenerationService,
  ImageGenerationError,
  GeminiImageGenerationError,
  type ImageGenerationApiType,
  type ConnectionInfo,
} from './image-generation-service.js'

export { generateImageOpenAI } from './providers/openai-compat.js'
export { generateImageGemini } from './providers/gemini-generate.js'

// 类型导出
export type { GeneratedImage, ImageGenerationResult, ImageGenerationOptions } from './types.js'

// 存储服务
export { GeneratedImageStorage, type SavedGeneratedImage, type SaveGeneratedImagesOptions } from './generated-image-storage.js'