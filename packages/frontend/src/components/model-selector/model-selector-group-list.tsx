import type { MouseEvent } from "react"
import { Check, ChevronRight, Star } from "lucide-react"
import type { ModelItem } from "@/store/models-store"
import { cn, deriveChannelName } from "@/lib/utils"
import { modelKeyFor } from "@/store/model-preference-store"
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command"
import { Skeleton } from "@/components/ui/skeleton"
import { formatContextWindow } from "./model-selector-utils"
import { ModelSelectorCapabilityBadges } from "./model-selector-capability-badges"

interface ModelSelectorGroupListProps {
  loading: boolean
  groupedModels: Record<string, ModelItem[]>
  collapsedGroups: Set<string>
  isModelSelected: (model: ModelItem) => boolean
  favoriteModelKeys: Set<string>
  onSelectModel: (model: ModelItem) => void
  onToggleGroup: (group: string) => void
  onToggleFavorite: (modelId: string, event: MouseEvent<HTMLButtonElement>) => void
  forceBottomDropdown: boolean
  emptyText: string
}

export function ModelSelectorGroupList({
  loading,
  groupedModels,
  collapsedGroups,
  isModelSelected,
  favoriteModelKeys,
  onSelectModel,
  onToggleGroup,
  onToggleFavorite,
  forceBottomDropdown,
  emptyText,
}: ModelSelectorGroupListProps) {
  const groupNames = Object.keys(groupedModels)

  return (
    <CommandList
      className={cn(
        "overscroll-contain",
        forceBottomDropdown ? "max-h-none min-h-0 flex-1" : "max-h-[min(62dvh,520px)]"
      )}
    >
      {loading && (
        <div className="space-y-2 p-2.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="rounded-md border border-border/50 p-2.5">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      )}

      {!loading && groupNames.length === 0 && <CommandEmpty>{emptyText}</CommandEmpty>}

      {!loading &&
        Object.entries(groupedModels).map(([provider, models]) => {
          const isCollapsed = collapsedGroups.has(provider)

          return (
            <div key={provider}>
              <button
                type="button"
                className="sticky top-0 z-10 flex w-full items-center justify-between border-b border-border/45 bg-background/95 px-2.5 py-2 text-xs font-semibold text-muted-foreground backdrop-blur-sm transition-colors hover:bg-muted/40"
                onClick={() => onToggleGroup(provider)}
              >
                <span className="flex items-center gap-1.5">
                  <ChevronRight
                    className={cn("h-3.5 w-3.5 transition-transform", !isCollapsed && "rotate-90")}
                  />
                  {provider}
                </span>
                <span>{models.length}</span>
              </button>

              {!isCollapsed && (
                <CommandGroup className="px-1.5 py-1">
                  {models.map((model) => {
                    const key = modelKeyFor(model)
                    const isActive = isModelSelected(model)
                    const isFavorite = favoriteModelKeys.has(key)
                    const channel =
                      model.channelName || deriveChannelName(model.provider, model.connectionBaseUrl)
                    const contextTokens =
                      typeof model.contextWindow === "number" && model.contextWindow > 0
                        ? formatContextWindow(model.contextWindow)
                        : null

                    return (
                      <CommandItem
                        key={`${model.connectionId}:${model.id}`}
                        value={`${model.name} ${model.id} ${model.provider} ${channel}`}
                        onSelect={() => onSelectModel(model)}
                        className={cn(
                          "my-1 rounded-md border px-2.5 py-2 transition-colors",
                          "data-[selected=true]:bg-muted/50 data-[selected=true]:text-foreground",
                          isActive
                            ? "border-primary/45 bg-primary/8"
                            : "border-border/50 hover:border-border hover:bg-muted/30"
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{model.name}</span>
                              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                            </div>
                            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                              <span className="truncate">
                                {model.provider} · {channel}
                              </span>
                              {contextTokens && <span className="shrink-0">{contextTokens}</span>}
                            </div>
                          </div>

                          <div className="hidden shrink-0 items-center gap-1 sm:flex">
                            <ModelSelectorCapabilityBadges model={model} compact />
                          </div>

                          <button
                            type="button"
                            onClick={(event) => onToggleFavorite(key, event)}
                            className={cn(
                              "rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted",
                              isFavorite && "text-amber-500"
                            )}
                            aria-label={isFavorite ? "取消收藏" : "收藏"}
                          >
                            <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
                          </button>
                        </div>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}
            </div>
          )
        })}
    </CommandList>
  )
}
