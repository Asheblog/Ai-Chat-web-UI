import type { ModelItem } from '@/store/models-store'

/** 六种强度值与 unset；unset 表示不显式设置，沿用系统设置。 */
export const MODEL_REASONING_EFFORTS = ['unset', 'low', 'medium', 'high', 'max', 'xhigh'] as const
export type ModelReasoningEffort = (typeof MODEL_REASONING_EFFORTS)[number]

/** 强度状态由上层持有；选择器只回传变化，不保存默认值或示例值。 */
export interface ModelReasoningControl {
  value: ModelReasoningEffort
  onChange: (value: ModelReasoningEffort) => void
  disabled?: boolean
}

/** 同一面板内的两个视图：模型列表与强度选项。 */
export type ModelSelectorView = 'models' | 'effort'

export interface ModelSelectorProps {
  // 连接级唯一键，格式为 connectionId:rawId。
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: 'default' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  dropdownDirection?: 'auto' | 'bottom'
  /** 提供后模型与强度共用入口；缺省保持纯模型选择的原有契约。 */
  reasoningControl?: ModelReasoningControl
  /** 可选受控展开，供“思考”等入口直接打开选择器。 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 每次展开时进入的视图；不传则停留在模型列表。 */
  defaultView?: ModelSelectorView
}
