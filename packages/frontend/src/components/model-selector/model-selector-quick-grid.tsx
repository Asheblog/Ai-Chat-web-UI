import { Check } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn } from "@/lib/utils"
import {
  collectDuplicateModelNames,
  formatModelOptionLabel,
} from "@/lib/model-display"
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

  const duplicateNames = collectDuplicateModelNames(quickModels)

  return (
    <div className="shrink-0 border-b border-border px-4 py-2.5">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="font-medium">常用</span>
        <span>最近 / 收藏</span>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {quickModels.map((model) => {
          const key = modelKeyFor(model)
          const isActive = isModelSelected(model)
          const accessibleLabel = formatModelOptionLabel(model)
          const showDisplayName =
            Boolean(model.displayName) && duplicateNames.has(model.name)

          return (
            <button
              key={key}
              type="button"
              data-model-select=""
              aria-pressed={isActive}
              onClick={() => onSelectModel(model)}
              className={cn(
                "inline-flex max-w-[210px] shrink-0 items-center gap-2 rounded-md border px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal",
                showDisplayName ? "min-h-9 py-1.5" : "h-9",
                isActive
                  ? "border-signal/25 bg-signal-soft text-signal-text"
                  : "border-border bg-background text-foreground hover:border-primary/35 hover:bg-signal-soft"
              )}
              title={accessibleLabel}
              aria-label={accessibleLabel}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{model.name}</span>
                {showDisplayName && (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {model.displayName}
                  </span>
                )}
              </span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
