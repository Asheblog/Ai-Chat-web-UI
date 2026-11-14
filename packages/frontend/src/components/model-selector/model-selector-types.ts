import type { ModelItem } from '@/store/models-store'

export interface ModelSelectorProps {
  // 连接级唯一键，格式为 connectionId:rawId。
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  disabled?: boolean
  className?: string
  variant?: 'default' | 'inline'
  size?: 'sm' | 'md' | 'lg'
  dropdownDirection?: 'auto' | 'bottom'
}
