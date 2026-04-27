import type { MouseEvent } from "react"
import { Check, Star } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn, deriveChannelName } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"
import { Skeleton } from "@/components/ui/skeleton"
import { formatContextWindow } from "./model-selector-utils"
import { ModelSelectorCapabilityBadges } from "./model-selector-capability-badges"

interface ModelSelectorGroupListProps {
  loading: boolean
  groupedModels: Record<string, ModelItem[]>
  activeGroup: string | null
  onActiveGroupChange: (group: string) => void
  isModelSelected: (model: ModelItem) => boolean
  favoriteModelKeys: Set<string>
  onSelectModel: (model: ModelItem) => void
  onToggleFavorite: (modelId: string, event: MouseEvent<HTMLButtonElement>) => void
  emptyText: string
  layout?: "desktop" | "mobile"
}

export function ModelSelectorGroupList({
  loading,
  groupedModels,
  activeGroup,
  onActiveGroupChange,
  isModelSelected,
  favoriteModelKeys,
  onSelectModel,
  onToggleFavorite,
  emptyText,
  layout = "desktop",
}: ModelSelectorGroupListProps) {
  const groupNames = Object.keys(groupedModels)
  const resolvedActiveGroup = activeGroup && groupedModels[activeGroup] ? activeGroup : groupNames[0] ?? null
  const activeModels = resolvedActiveGroup ? groupedModels[resolvedActiveGroup] ?? [] : []

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="rounded-[8px] border border-border/50 p-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    )
  }

  if (groupNames.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        {emptyText}
      </div>
    )
  }

  if (layout === "mobile") {
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border/60 px-3 py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {groupNames.map((group) => (
            <button
              key={group}
              type="button"
              className={cn(
                "h-9 shrink-0 rounded-[8px] px-3 text-sm font-medium transition-colors",
                resolvedActiveGroup === group
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
              onClick={() => onActiveGroupChange(group)}
            >
              {group}
            </button>
          ))}
        </div>
        <ModelRows
          models={activeModels}
          groupName={resolvedActiveGroup}
          isModelSelected={isModelSelected}
          favoriteModelKeys={favoriteModelKeys}
          onSelectModel={onSelectModel}
          onToggleFavorite={onToggleFavorite}
          compact
        />
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[164px_minmax(0,1fr)] overflow-hidden">
      <div className="min-h-0 border-r border-border/60 bg-muted/20">
        <div className="max-h-[min(48dvh,430px)] overflow-y-auto p-2">
          {groupNames.map((group) => (
            <button
              key={group}
              type="button"
              className={cn(
                "flex h-9 w-full items-center justify-between rounded-[8px] px-2.5 text-left text-sm transition-colors",
                resolvedActiveGroup === group
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
              onClick={() => onActiveGroupChange(group)}
              aria-pressed={resolvedActiveGroup === group}
            >
              <span className="truncate font-medium">{group}</span>
              <span className="ml-2 shrink-0 text-xs">{groupedModels[group]?.length ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden bg-background">
        <div className="flex h-10 items-center justify-between border-b border-border/60 px-3">
          <div className="min-w-0 text-sm">
            <span className="font-semibold text-foreground">{resolvedActiveGroup}</span>
            <span className="ml-2 text-xs text-muted-foreground">{activeModels.length} 个模型</span>
          </div>
        </div>
        <ModelRows
          models={activeModels}
          groupName={resolvedActiveGroup}
          isModelSelected={isModelSelected}
          favoriteModelKeys={favoriteModelKeys}
          onSelectModel={onSelectModel}
          onToggleFavorite={onToggleFavorite}
        />
      </div>
    </div>
  )
}

interface ModelRowsProps {
  models: ModelItem[]
  groupName: string | null
  isModelSelected: (model: ModelItem) => boolean
  favoriteModelKeys: Set<string>
  onSelectModel: (model: ModelItem) => void
  onToggleFavorite: (modelId: string, event: MouseEvent<HTMLButtonElement>) => void
  compact?: boolean
}

function ModelRows({
  models,
  groupName,
  isModelSelected,
  favoriteModelKeys,
  onSelectModel,
  onToggleFavorite,
  compact,
}: ModelRowsProps) {
  if (models.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        {groupName ? "该分组暂无可用模型" : "暂无可用模型"}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "min-h-0 overflow-y-auto overscroll-contain",
        compact ? "max-h-[calc(82dvh-190px)] px-3 py-2" : "max-h-[min(48dvh,430px)] p-2"
      )}
    >
      {models.map((model) => {
        const key = modelKeyFor(model)
        const isActive = isModelSelected(model)
        const isFavorite = favoriteModelKeys.has(key)
        const channel = model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)
        const contextTokens =
          typeof model.contextWindow === "number" && model.contextWindow > 0
            ? formatContextWindow(model.contextWindow)
            : null

        return (
          <div
            key={key}
            role="option"
            aria-selected={isActive}
            className={cn(
              "group/model-row mb-1 flex items-center rounded-[8px] border transition-colors",
              compact ? "min-h-[58px] px-2.5 py-2" : "min-h-[58px] px-2.5 py-2",
              isActive
                ? "border-primary/45 bg-primary/8"
                : "border-transparent hover:border-border/70 hover:bg-muted/35"
            )}
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left outline-none"
              onClick={() => onSelectModel(model)}
              title={model.name}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold leading-5 text-foreground">
                  {model.name}
                </span>
                {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <span className="truncate">{model.provider} · {channel}</span>
              </div>
            </button>

            <div className="ml-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <ModelSelectorCapabilityBadges model={model} compact />
              {contextTokens && <span className="tabular-nums">{contextTokens}</span>}
              <button
                type="button"
                onClick={(event) => onToggleFavorite(key, event)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors hover:bg-muted",
                  isFavorite ? "text-amber-500" : "text-muted-foreground"
                )}
                aria-label={isFavorite ? "取消收藏" : "收藏"}
              >
                <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
