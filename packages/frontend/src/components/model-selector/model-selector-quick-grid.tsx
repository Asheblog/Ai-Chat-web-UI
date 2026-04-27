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
    <div className="border-b border-border/60 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium">常用</span>
        <span>最近 / 收藏</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickModels.map((model) => {
          const key = modelKeyFor(model)
          const isActive = isModelSelected(model)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectModel(model)}
              className={cn(
                "inline-flex h-9 max-w-[210px] shrink-0 items-center gap-2 rounded-[8px] border px-3 text-left text-xs transition-colors",
                isActive
                  ? "border-primary/45 bg-primary/8 text-primary"
                  : "border-border/60 bg-background text-foreground hover:border-primary/35 hover:bg-primary/5"
              )}
              title={model.name}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{model.name}</span>
              </span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
