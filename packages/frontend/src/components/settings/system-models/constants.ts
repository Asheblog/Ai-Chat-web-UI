import type { ComponentType } from "react"
import { Eye, Image as ImageIcon } from "lucide-react"

export const MODEL_CAP_KEYS = ['vision', 'image_generation'] as const
export type ModelCapKey = typeof MODEL_CAP_KEYS[number]

export const MODEL_CAP_LABELS: Record<ModelCapKey, string> = {
  vision: '图片理解',
  image_generation: '图像生成',
}

export const MODEL_CAP_ICONS: Record<ModelCapKey, ComponentType<{ className?: string }>> = {
  vision: Eye,
  image_generation: ImageIcon,
}

export const MODEL_CAP_SOURCE_LABELS: Record<string, string> = {
  manual: '手动设置',
  connection_default: '连接默认',
  provider: '供应商标注',
  heuristic: '系统推断',
  legacy: '兼容标签',
}
