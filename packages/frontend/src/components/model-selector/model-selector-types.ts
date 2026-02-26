import { Eye, Globe, Palette, Paperclip, Terminal } from "lucide-react"
import type { ModelItem } from "@/store/models-store"

export interface ModelSelectorProps {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: "default" | "inline"
  dropdownDirection?: "auto" | "bottom"
}

export type CapabilityFilter =
  | "all"
  | "vision"
  | "web_search"
  | "code_interpreter"
  | "image_generation"

export type SelectorView = "all" | "favorites" | "recent"

export const RECENT_MODELS_KEY = "recent-models"
export const FAVORITE_MODELS_KEY = "favorite-models"

export const CAPABILITY_ICONS = {
  vision: { icon: Eye, label: "Vision", title: "图片理解" },
  file_upload: { icon: Paperclip, label: "File", title: "文件上传" },
  web_search: { icon: Globe, label: "Web", title: "联网搜索" },
  image_generation: { icon: Palette, label: "Image", title: "图像生成" },
  code_interpreter: { icon: Terminal, label: "Code", title: "代码执行" },
} as const

export type CapabilityKey = keyof typeof CAPABILITY_ICONS

export const VIEW_FILTER_OPTIONS: Array<{ id: SelectorView; label: string }> = [
  { id: "all", label: "全部" },
  { id: "favorites", label: "收藏" },
  { id: "recent", label: "最近" },
]

export const CAPABILITY_FILTER_OPTIONS: Array<{
  id: CapabilityFilter
  label: string
  icon?: (typeof CAPABILITY_ICONS)[CapabilityKey]["icon"]
}> = [
  { id: "all", label: "全部" },
  { id: "vision", label: "多模态", icon: Eye },
  { id: "web_search", label: "联网", icon: Globe },
  { id: "image_generation", label: "绘图", icon: Palette },
  { id: "code_interpreter", label: "编程", icon: Terminal },
]

export const PRIORITY_GROUP_ORDER = [
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepSeek",
  "Llama",
  "Qwen",
  "Cohere",
  "Mistral",
  "Moonshot",
  "GLM",
] as const
