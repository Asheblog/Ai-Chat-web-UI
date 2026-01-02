export {
  ImageGenerationService,
  imageGenerationService,
  setImageGenerationService,
  ImageGenerationError,
  GeminiImageGenerationError,
  type ImageGenerationResult,
  type ImageGenerationOptions,
  type ImageGenerationApiType,
  type ConnectionInfo,
} from './image-generation-service.js'

export { generateImageOpenAI, type GeneratedImage } from './providers/openai-compat.js'
export { generateImageGemini } from './providers/gemini-generate.js'