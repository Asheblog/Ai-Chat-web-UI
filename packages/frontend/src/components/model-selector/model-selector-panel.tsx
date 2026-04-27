"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ModelItem } from "@/store/models-store"
import { useModelsStore } from "@/store/models-store"
import { modelKeyFor } from "@/store/model-preference-store"
import { Button } from "@/components/ui/button"
import { Command } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
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
  size = "md",
  dropdownDirection = "auto",
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [selectorView, setSelectorView] = useState<SelectorView>("all")
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("all")
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const { models: allModels, isLoading: loading, fetchAll } = useModelsStore()
  const modelsCount = allModels.length
  const forceBottomDropdown = dropdownDirection === "bottom"

  useEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(max-width: 767px)")
    const sync = () => setIsMobile(media.matches)

    sync()
    media.addEventListener?.("change", sync)
    return () => media.removeEventListener?.("change", sync)
  }, [])

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

      if (canScrollY) {
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
    if (groupNames.length === 0) {
      setActiveGroup(null)
      return
    }

    setActiveGroup((current) => {
      if (current && groupedModels[current]) {
        return current
      }

      const selectedGroup = groupNames.find((group) =>
        groupedModels[group]?.some((model) => isModelSelected(model, selectedModelId))
      )

      return selectedGroup ?? groupNames[0] ?? null
    })
  }, [groupNames, groupedModels, selectedModelId])

  useEffect(() => {
    if (!open || groupNames.length === 0) {
      return
    }

    setActiveGroup((current) => {
      if (current && groupedModels[current]) {
        return current
      }
      const selectedGroup = groupNames.find((group) =>
        groupedModels[group]?.some((model) => isModelSelected(model, selectedModelId))
      )
      return selectedGroup ?? groupNames[0] ?? null
    })
  }, [open, groupNames, groupedModels, selectedModelId])

  const handleRefresh = useCallback(() => {
    fetchAll().catch(() => {})
  }, [fetchAll])

  const totalConnections = useMemo(
    () => new Set(allModels.map((model) => model.connectionId).filter((id) => id != null)).size,
    [allModels]
  )

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

  const selectorContent = (
    <Command shouldFilter={false} className={cn("border-0 bg-background", isMobile && "h-full")}>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-3">
        <div className="min-w-0">
          <div className="text-base font-semibold leading-6 text-foreground">选择模型</div>
          <div className="text-xs text-muted-foreground">
            {visibleCount} 个模型{totalConnections > 0 ? ` · ${totalConnections} 个连接` : ""}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-[8px] text-muted-foreground hover:text-foreground"
          onClick={handleRefresh}
          aria-label="刷新模型目录"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      <ModelSelectorSearchControls
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        selectorView={selectorView}
        onSelectorViewChange={setSelectorView}
        capabilityFilter={capabilityFilter}
        onCapabilityFilterChange={setCapabilityFilter}
        searchInputRef={searchInputRef}
      />

      {showQuickModels && !isMobile && (
        <ModelSelectorQuickGrid
          quickModels={quickModels}
          isModelSelected={isSelected}
          onSelectModel={handleSelectModel}
        />
      )}

      <ModelSelectorGroupList
        loading={loading}
        groupedModels={groupedModels}
        activeGroup={activeGroup}
        onActiveGroupChange={setActiveGroup}
        isModelSelected={isSelected}
        favoriteModelKeys={favoriteModelKeys}
        onSelectModel={handleSelectModel}
        onToggleFavorite={handleToggleFavorite}
        emptyText={emptyText}
        layout={isMobile ? "mobile" : "desktop"}
      />
    </Command>
  )

  const trigger = (
    <ModelSelectorTrigger
      ref={triggerRef}
      open={open}
      selected={selected}
      disabled={disabled}
      className={className}
      displayVariant={variant}
      selectorSize={size}
    />
  )

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          dialogTitle="选择模型"
          className="max-h-[86dvh] rounded-t-[16px] border-border/80 bg-background p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-border" aria-hidden="true" />
          {selectorContent}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        portalContainer={portalContainer}
        side={forceBottomDropdown ? "bottom" : undefined}
        align={forceBottomDropdown ? "start" : undefined}
        sideOffset={forceBottomDropdown ? 8 : undefined}
        style={
          forceBottomDropdown
            ? { height: "min(var(--radix-popover-content-available-height, 78dvh), 680px)" }
            : undefined
        }
        className={cn(
          "w-[min(96vw,580px)] overflow-hidden rounded-xl border border-border/70 bg-background p-0 shadow-xl",
          forceBottomDropdown
            ? "max-h-[var(--radix-popover-content-available-height)]"
            : "max-h-[min(78dvh,660px)]"
        )}
      >
        {selectorContent}
      </PopoverContent>
    </Popover>
  )
}
