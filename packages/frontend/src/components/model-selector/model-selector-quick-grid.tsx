import { Check } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"

interface ModelSelectorQuickGridProps {
  quickModels: ModelItem[]
  isModelSelected: (model: ModelItem) => boolean
  onSelectModel: (model: ModelItem) => void
}

export function ModelSelectorQuickGrid({
  quickModels,
  isModelSelected,
  onSelectModel,
}: ModelSelectorQuickGridProps) {
  if (quickModels.length === 0) {
    return null
  }

  return (
    <div className="border-b border-border/60 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>快捷模型</span>
        <span>最近 + 收藏</span>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {quickModels.map((model) => {
          const key = modelKeyFor(model)
          const isActive = isModelSelected(model)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectModel(model)}
              className={cn(
                "inline-flex h-8 max-w-[220px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                isActive
                  ? "border-primary/45 bg-primary/8 text-primary"
                  : "border-border/60 bg-background text-foreground hover:border-primary/35 hover:bg-primary/5"
              )}
              title={model.name}
            >
              <span className="truncate">{model.name}</span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
