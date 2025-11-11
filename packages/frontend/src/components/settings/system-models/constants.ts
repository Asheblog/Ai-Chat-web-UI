import type { ComponentType } from "react"
import { Eye, FileUp, Globe, Image as ImageIcon, Code2 } from "lucide-react"

export const MODEL_CAP_KEYS = ['vision', 'file_upload', 'web_search', 'image_generation', 'code_interpreter'] as const
export type ModelCapKey = typeof MODEL_CAP_KEYS[number]

export const MODEL_CAP_LABELS: Record<ModelCapKey, string> = {
  vision: '图片理解',
  file_upload: '文件上传',
  web_search: '联网搜索',
  image_generation: '图像生成',
  code_interpreter: '代码解释器',
}

export const MODEL_CAP_ICONS: Record<ModelCapKey, ComponentType<{ className?: string }>> = {
  vision: Eye,
  file_upload: FileUp,
  web_search: Globe,
  image_generation: ImageIcon,
  code_interpreter: Code2,
}

export const MODEL_CAP_SOURCE_LABELS: Record<string, string> = {
  manual: '手动设置',
  connection_default: '连接默认',
  provider: '供应商标注',
  heuristic: '系统推断',
  legacy: '兼容标签',
}
