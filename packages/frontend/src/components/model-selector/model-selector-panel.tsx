"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import type { ModelItem } from "@/store/models-store"
import { useModelsStore } from "@/store/models-store"
import { modelKeyFor } from "@/store/model-preference-store"
import { Button } from "@/components/ui/button"
import { Command } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  FAVORITE_MODELS_KEY,
  RECENT_MODELS_KEY,
  type ModelSelectorProps,
} from "./model-selector-types"
import {
  buildModelCollections,
  isModelSelected,
  parseStoredModelIds,
} from "./model-selector-utils"
import { ModelSelectorTrigger } from "./model-selector-trigger"
import { ModelSelectorSearchControls } from "./model-selector-search-controls"
import { ModelSelectorQuickGrid } from "./model-selector-quick-grid"
import { ModelSelectorGroupList } from "./model-selector-group-list"

export function ModelSelector({
  selectedModelId,
  onModelChange,
  disabled,
  className,
  variant = "default",
  dropdownDirection = "auto",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectorView, setSelectorView] = useState<"all" | "favorites" | "recent">("all")
  const [capabilityFilter, setCapabilityFilter] = useState<
    "all" | "vision" | "web_search" | "code_interpreter" | "image_generation"
  >("all")
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const searchInputRef = useRef<HTMLInputElement>(null)

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

  const selected = useMemo(() => {
    return allModels.find((model) => isModelSelected(model, selectedModelId))
  }, [allModels, selectedModelId])

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

  const collections = useMemo(() => {
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

  const { groupedModels, quickModels, visibleCount, favoriteModelKeys } = collections

  const isSelected = useCallback(
    (model: ModelItem) => isModelSelected(model, selectedModelId),
    [selectedModelId]
  )

  useEffect(() => {
    setCollapsedGroups((current) => {
      if (current.size === 0) {
        return current
      }

      const availableGroups = new Set(Object.keys(groupedModels))
      const next = new Set<string>()

      for (const group of current) {
        if (availableGroups.has(group)) {
          next.add(group)
        }
      }

      return next.size === current.size ? current : next
    })
  }, [groupedModels])

  const groupNames = Object.keys(groupedModels)
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ModelSelectorTrigger
          open={open}
          selected={selected}
          disabled={disabled}
          className={className}
          displayVariant={variant}
        />
      </PopoverTrigger>
      <PopoverContent
        side={forceBottomDropdown ? "bottom" : undefined}
        align={forceBottomDropdown ? "start" : undefined}
        sideOffset={forceBottomDropdown ? 8 : undefined}
        avoidCollisions={forceBottomDropdown ? false : undefined}
        className="w-[420px] max-w-[min(95vw,420px)] overflow-hidden rounded-xl border border-border/70 p-0 shadow-xl"
      >
        <Command shouldFilter={false} className={forceBottomDropdown ? "h-full border-0" : "border-0"}>
          <ModelSelectorSearchControls
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
            selectorView={selectorView}
            onSelectorViewChange={setSelectorView}
            capabilityFilter={capabilityFilter}
            onCapabilityFilterChange={setCapabilityFilter}
            searchInputRef={searchInputRef}
          />

          {quickModels.length > 0 &&
            !searchTerm &&
            selectorView === "all" &&
            capabilityFilter === "all" && (
              <ModelSelectorQuickGrid
                quickModels={quickModels}
                isModelSelected={isSelected}
                onSelectModel={handleSelectModel}
              />
            )}

          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{visibleCount} 个模型</div>
            {groupNames.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-md px-2 text-xs text-muted-foreground"
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
