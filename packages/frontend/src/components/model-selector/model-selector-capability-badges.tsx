import { MessageCircle } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { Badge } from "@/components/ui/badge"
import { CAPABILITY_ICONS } from "./model-selector-types"

interface ModelSelectorCapabilityBadgesProps {
  model: ModelItem
  compact?: boolean
}

export function ModelSelectorCapabilityBadges({
  model,
  compact = false,
}: ModelSelectorCapabilityBadgesProps) {
  const capabilities = model.capabilities || {}
  const activeCapabilities = Object.entries(CAPABILITY_ICONS).filter(
    ([key]) => capabilities[key as keyof typeof capabilities]
  )

  if (activeCapabilities.length === 0) {
    return (
      <Badge
        variant="secondary"
        className="h-5 rounded-full border border-border/60 bg-muted/55 px-1.5 text-[10px] text-muted-foreground"
        title="通用对话"
      >
        <MessageCircle className="h-3 w-3" />
        {!compact && <span className="ml-1">General</span>}
      </Badge>
    )
  }

  const visibleCapabilities = compact ? activeCapabilities.slice(0, 3) : activeCapabilities
  const hiddenCount = activeCapabilities.length - visibleCapabilities.length

  return (
    <div className="flex items-center gap-1">
      {visibleCapabilities.map(([key, config]) => {
        const Icon = config.icon
        return (
          <Badge
            key={key}
            variant="secondary"
            className="h-5 rounded-full border border-border/60 bg-muted/55 px-1.5 text-[10px] text-muted-foreground"
            title={config.title}
          >
            <Icon className="h-3 w-3" />
            {!compact && <span className="ml-1">{config.label}</span>}
          </Badge>
        )
      })}
      {compact && hiddenCount > 0 && (
        <span className="text-[10px] text-muted-foreground">+{hiddenCount}</span>
      )}
    </div>
  )
}
