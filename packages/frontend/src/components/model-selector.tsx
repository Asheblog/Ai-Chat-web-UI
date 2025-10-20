'use client'

import { useState, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { ModelConfig } from '@/types'
import { useSettingsStore } from '@/store/settings-store'
import { cn } from '@/lib/utils'

interface ModelSelectorProps {
  selectedModelId: number
  onModelChange: (modelId: number) => void
  disabled?: boolean
  className?: string
}

export function ModelSelector({ selectedModelId, onModelChange, disabled, className }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const { systemSettings, personalModels, fetchSystemSettings, fetchPersonalModels } = useSettingsStore()
  const [allModels, setAllModels] = useState<ModelConfig[]>([])

  useEffect(() => {
    fetchSystemSettings()
    fetchPersonalModels()
  }, [fetchSystemSettings, fetchPersonalModels])

  useEffect(() => {
    const models: ModelConfig[] = []

    // 添加系统模型
    if (systemSettings?.systemModels) {
      models.push(...systemSettings.systemModels)
    }

    // 添加个人模型
    models.push(...personalModels)

    setAllModels(models)
  }, [systemSettings, personalModels])

  const selectedModel = allModels.find(model => model.id === selectedModelId)

  const handleModelSelect = (modelId: number) => {
    onModelChange(modelId)
    setIsOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
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

      {isOpen && (
        <>
          {/* 覆盖层 */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* 下拉菜单 */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-popover border rounded-md shadow-lg z-20 max-h-64 overflow-y-auto">
            {allModels.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                暂无可用模型
              </div>
            ) : (
              <>
                {/* 系统模型 */}
                {systemSettings?.systemModels && systemSettings.systemModels.length > 0 && (
                  <div>
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      系统模型
                    </div>
                    {systemSettings.systemModels.map((model) => (
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
                        <div className="text-xs text-muted-foreground">
                          {model.apiUrl}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* 个人模型 */}
                {personalModels.length > 0 && (
                  <div>
                    <div className="px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      个人模型
                    </div>
                    {personalModels.map((model) => (
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
                        <div className="text-xs text-muted-foreground">
                          {model.apiUrl}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}