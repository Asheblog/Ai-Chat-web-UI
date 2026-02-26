import { Check } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn, deriveChannelName } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"
import { ModelSelectorCapabilityBadges } from "./model-selector-capability-badges"

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
    <div className="border-b border-border/60 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold text-muted-foreground">常用模型</div>
        <div className="text-[11px] text-muted-foreground">最近 + 收藏</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {quickModels.map((model) => {
          const key = modelKeyFor(model)
          const isActive = isModelSelected(model)
          const channel = model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)

          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelectModel(model)}
              className={cn(
                "rounded-lg border px-3 py-2 text-left transition-colors",
                isActive
                  ? "border-primary/45 bg-primary/8"
                  : "border-border/60 bg-background hover:border-primary/35 hover:bg-primary/5"
              )}
            >
              <div className="truncate text-xs font-semibold">{model.name}</div>
              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                {model.provider} · {channel}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <ModelSelectorCapabilityBadges model={model} compact />
                </div>
                {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
