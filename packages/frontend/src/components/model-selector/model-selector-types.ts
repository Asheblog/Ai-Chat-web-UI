import { Eye, Palette } from "lucide-react"
import type { ModelItem } from "@/store/models-store"

export interface ModelSelectorProps {
  // 连接级唯一键，格式: `${connectionId}:${rawId}`
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: "default" | "inline"
  size?: "sm" | "md" | "lg"
  dropdownDirection?: "auto" | "bottom"
}

export type CapabilityFilter =
  | "all"
  | "vision"
  | "image_generation"

export type SelectorView = "all" | "favorites" | "recent"

export const RECENT_MODELS_KEY = "recent-models"
export const FAVORITE_MODELS_KEY = "favorite-models"

export const CAPABILITY_ICONS = {
  vision: { icon: Eye, label: "Vision", title: "图片理解" },
  image_generation: { icon: Palette, label: "Image", title: "图像生成" },
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
  { id: "vision", label: "视觉", icon: Eye },
  { id: "image_generation", label: "绘图", icon: Palette },
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
