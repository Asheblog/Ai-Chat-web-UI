"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { cn } from "@/lib/utils"
import type { ModelItem } from "@/store/models-store"
import { useModelsStore } from "@/store/models-store"
import { modelKeyFor } from "@/store/model-preference-store"
import { Button } from "@/components/ui/button"
import { Command } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  FAVORITE_MODELS_KEY,
  RECENT_MODELS_KEY,
  type CapabilityFilter,
  type ModelSelectorProps,
  type SelectorView,
} from "./model-selector-types"
import { buildModelCollections, isModelSelected, parseStoredModelIds } from "./model-selector-utils"
import { ModelSelectorGroupList } from "./model-selector-group-list"
import { ModelSelectorQuickGrid } from "./model-selector-quick-grid"
import { ModelSelectorSearchControls } from "./model-selector-search-controls"
import { ModelSelectorTrigger } from "./model-selector-trigger"

export function ModelSelector({
  selectedModelId,
  onModelChange,
  disabled,
  className,
  variant = "default",
  dropdownDirection = "auto",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectorView, setSelectorView] = useState<SelectorView>("all")
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all")
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const { models: allModels, isLoading: loading, fetchAll } = useModelsStore()
  const modelsCount = allModels.length
  const forceBottomDropdown = dropdownDirection === "bottom"

  useEffect(() => {
    if (modelsCount === 0) {
      fetchAll().catch(() => {})
    }

    setRecentModels(parseStoredModelIds(localStorage.getItem(RECENT_MODELS_KEY)))
    setFavoriteModels(parseStoredModelIds(localStorage.getItem(FAVORITE_MODELS_KEY)))
  }, [modelsCount, fetchAll])

  useEffect(() => {
    if (!open) {
      setSearchTerm("")
      return
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus()
    }, 30)

    return () => {
      window.clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return
    }

    let current: HTMLElement | null = triggerRef.current
    let nearestScrollable: HTMLElement | null = null

    while (current) {
      const style = window.getComputedStyle(current)
      const overflowY = style.overflowY
      const canScrollY = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay"

      if (canScrollY && current.scrollHeight > current.clientHeight) {
        nearestScrollable = current
        break
      }

      current = current.parentElement
    }

    setPortalContainer(nearestScrollable)
  }, [open])

  const selected = useMemo(() => {
    return allModels.find((model) => isModelSelected(model, selectedModelId))
  }, [allModels, selectedModelId])

  const isSelected = useCallback(
    (model: ModelItem) => isModelSelected(model, selectedModelId),
    [selectedModelId]
  )

  const handleSelectModel = useCallback(
    (model: ModelItem) => {
      onModelChange(model)
      setRecentModels((current) => {
        const key = modelKeyFor(model)
        const next = [key, ...current.filter((id) => id !== key)].slice(0, 6)

        try {
          localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next))
        } catch (error) {
          console.error("Failed to save recent models:", error)
        }

        return next
      })
      setOpen(false)
    },
    [onModelChange]
  )

  const handleToggleFavorite = useCallback((modelId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()

    setFavoriteModels((current) => {
      const next = current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : [...current, modelId]

      try {
        localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(next))
      } catch (error) {
        console.error("Failed to save favorite models:", error)
      }

      return next
    })
  }, [])

  const { groupedModels, quickModels, visibleCount, favoriteModelKeys } = useMemo(() => {
    return buildModelCollections({
      allModels,
      searchTerm,
      selectorView,
      capabilityFilter,
      recentModels,
      favoriteModels,
      selectedModelId,
    })
  }, [
    allModels,
    searchTerm,
    selectorView,
    capabilityFilter,
    recentModels,
    favoriteModels,
    selectedModelId,
  ])

  const groupNames = useMemo(() => Object.keys(groupedModels), [groupedModels])

  useEffect(() => {
    setCollapsedGroups((current) => {
      if (current.size === 0) {
        return current
      }

      const availableGroups = new Set(groupNames)
      const next = new Set<string>()

      for (const group of current) {
        if (availableGroups.has(group)) {
          next.add(group)
        }
      }

      return next.size === current.size ? current : next
    })
  }, [groupNames])

  useEffect(() => {
    if (!open || groupNames.length === 0) {
      return
    }

    const selectedGroup = groupNames.find((group) =>
      groupedModels[group]?.some((model) => isModelSelected(model, selectedModelId))
    )
    const defaultOpenGroup = selectedGroup ?? groupNames[0]
    const collapsed = new Set(groupNames.filter((group) => group !== defaultOpenGroup))

    setCollapsedGroups(collapsed)
  }, [open, groupNames, groupedModels, selectedModelId])

  const allGroupsCollapsed =
    groupNames.length > 0 && groupNames.every((groupName) => collapsedGroups.has(groupName))

  const handleToggleGroup = useCallback((group: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(group)) {
        next.delete(group)
      } else {
        next.add(group)
      }
      return next
    })
  }, [])

  const handleToggleAllGroups = useCallback(() => {
    setCollapsedGroups((current) => {
      const shouldCollapse = !groupNames.every((groupName) => current.has(groupName))
      return shouldCollapse ? new Set(groupNames) : new Set()
    })
  }, [groupNames])

  const emptyText = useMemo(() => {
    if (searchTerm) {
      return "没有匹配的模型，试试其他关键词"
    }
    if (selectorView === "favorites") {
      return "还没有收藏的模型"
    }
    if (selectorView === "recent") {
      return "最近没有使用记录"
    }
    if (capabilityFilter !== "all") {
      return "当前能力筛选下暂无模型"
    }
    return "暂无可用模型"
  }, [searchTerm, selectorView, capabilityFilter])

  const showQuickModels =
    quickModels.length > 0 &&
    !searchTerm &&
    selectorView === "all" &&
    capabilityFilter === "all"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ModelSelectorTrigger
          ref={triggerRef}
          open={open}
          selected={selected}
          disabled={disabled}
          className={className}
          displayVariant={variant}
        />
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        side={forceBottomDropdown ? "bottom" : undefined}
        align={forceBottomDropdown ? "start" : undefined}
        sideOffset={forceBottomDropdown ? 8 : undefined}
        avoidCollisions={forceBottomDropdown ? false : undefined}
        className={cn(
          "w-[min(96vw,520px)] overflow-hidden rounded-xl border border-border/70 p-0 shadow-xl",
          forceBottomDropdown
            ? "max-h-[var(--radix-popover-content-available-height)]"
            : "max-h-[min(78dvh,680px)]"
        )}
      >
        <Command shouldFilter={false} className={cn("border-0", forceBottomDropdown && "h-full")}>
          <ModelSelectorSearchControls
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            selectorView={selectorView}
            onSelectorViewChange={setSelectorView}
            capabilityFilter={capabilityFilter}
            onCapabilityFilterChange={setCapabilityFilter}
            searchInputRef={searchInputRef}
          />

          {showQuickModels && (
            <ModelSelectorQuickGrid
              quickModels={quickModels}
              isModelSelected={isSelected}
              onSelectModel={handleSelectModel}
            />
          )}

          <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
            <div className="text-[11px] text-muted-foreground">{visibleCount} 个模型</div>
            {groupNames.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 rounded-md px-2 text-[11px] text-muted-foreground"
                onClick={handleToggleAllGroups}
              >
                {allGroupsCollapsed ? "展开全部" : "折叠全部"}
              </Button>
            )}
          </div>

          <ModelSelectorGroupList
            loading={loading}
            groupedModels={groupedModels}
            collapsedGroups={collapsedGroups}
            isModelSelected={isSelected}
            favoriteModelKeys={favoriteModelKeys}
            onSelectModel={handleSelectModel}
            onToggleGroup={handleToggleGroup}
            onToggleFavorite={handleToggleFavorite}
            forceBottomDropdown={forceBottomDropdown}
            emptyText={emptyText}
          />
        </Command>
      </PopoverContent>
    </Popover>
  )
}
