export interface ChatImageLimitConfig {
  /** 单次最多上传的图片数量 */
  maxCount: number
  /** 单张图片最大大小（MB） */
  maxMb: number
  /** 单张图片最大边长（像素） */
  maxEdge: number
  /** 单次上传的图片总体积上限（MB） */
  maxTotalMb: number
}

export const DEFAULT_CHAT_IMAGE_LIMITS: ChatImageLimitConfig = {
  maxCount: 8,
  maxMb: 15,
  maxEdge: 8192,
  maxTotalMb: 60,
}
