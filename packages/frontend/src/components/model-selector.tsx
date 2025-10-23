'use client'

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { apiClient } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  selectedModelId: string | null
  onModelChange: (modelId: string) => void
  disabled?: boolean
  className?: string
  /**
   * 展示形态：
   * - default：按钮+文案（当前使用位置保持不变）
   * - inline：紧凑触发（仅图标按钮，适合放到输入框右侧）
   */
  variant?: 'default' | 'inline'
}

export function ModelSelector({ selectedModelId, onModelChange, disabled, className, variant = 'default' }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [allModels, setAllModels] = useState<Array<{ id: string; name: string; provider: string; connectionId: number }>>([])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await apiClient.getAggregatedModels()
        setAllModels(res.data || [])
      } catch (e) {
        setAllModels([])
      }
    })()
  }, [])

  useEffect(() => {
    // no-op for aggregated models
  }, [])

  const selectedModel = allModels.find(model => model.id === selectedModelId)

  const handleModelSelect = (modelId: string) => {
    onModelChange(modelId)
    setIsOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
      {variant === 'default' ? (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            "flex items-center gap-2 px-3 py-2 text-sm border rounded-md bg-background hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          <span className="truncate max-w-[200px]">
            {selectedModel ? selectedModel.name : '选择模型'}
          </span>
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          title={selectedModel ? `当前模型：${selectedModel.name}` : '选择模型'}
          className={cn(
            // 圆形“行内”触发器，适合放到输入框右侧工具区
            "h-10 w-10 flex items-center justify-center rounded-full border bg-background text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-label="选择模型"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      {isOpen && (
        <>
          {/* 覆盖层 */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* 下拉菜单 */}
          <div className={cn(
            "absolute mt-1 w-64 bg-popover border rounded-md shadow-lg z-20 max-h-64 overflow-y-auto",
            // inline 形态更可能放在容器右侧，菜单对齐到右边更自然
            variant === 'inline' ? 'top-full right-0' : 'top-full left-0'
          )}>
            {allModels.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                暂无可用模型
              </div>
            ) : (
              <>
                {allModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleModelSelect(model.id)}
                    className={cn(
                      "w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors",
                      selectedModelId === model.id && "bg-muted"
                    )}
                  >
                    <div className="font-medium">{model.name}</div>
                    <div className="text-xs text-muted-foreground">{model.id}</div>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
