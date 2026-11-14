"use client"

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { ModelSelectorProps } from './model-selector-types'
import { ModelSelectorGroupList } from './model-selector-group-list'
import { ModelSelectorQuickGrid } from './model-selector-quick-grid'
import { ModelSelectorSearchControls } from './model-selector-search-controls'
import { ModelSelectorTrigger } from './model-selector-trigger'
import { ModelSelectorHeader } from './model-selector-header'
import { handleModelSelectorKeyDown } from './model-selector-keyboard'
import { useModelSelector } from './use-model-selector'

export function ModelSelector({ selectedModelId, onModelChange, disabled, className, variant = 'default', size = 'md', dropdownDirection = 'auto' }: ModelSelectorProps) {
  const state = useModelSelector(selectedModelId, onModelChange)
  const forceBottomDropdown = dropdownDirection === 'bottom'
  const content = (
    <div className="flex h-full min-h-0 flex-col bg-surface" onKeyDown={handleModelSelectorKeyDown}>
      <ModelSelectorHeader count={state.visibleCount} connections={state.totalConnections} loading={state.loading} error={state.error} hasModels={state.allModels.length > 0} onRefresh={state.refresh} onClose={() => state.setOpen(false)} />
      <ModelSelectorSearchControls searchTerm={state.searchTerm} onSearchTermChange={state.setSearchTerm} selectorView={state.selectorView} onSelectorViewChange={state.setSelectorView} capabilityFilter={state.capabilityFilter} onCapabilityFilterChange={state.setCapabilityFilter} searchInputRef={state.searchInputRef} />
      {state.showQuickModels && !state.isMobile && (
        <ModelSelectorQuickGrid quickModels={state.quickModels} isModelSelected={state.isSelected} onSelectModel={state.selectModel} />
      )}
      {!(state.error && state.allModels.length === 0 && !state.loading) && (
        <ModelSelectorGroupList loading={state.loading && state.allModels.length === 0} groupedModels={state.groupedModels} activeGroup={state.activeGroup} onActiveGroupChange={state.setActiveGroup} isModelSelected={state.isSelected} favoriteModelKeys={state.favoriteModelKeys} onSelectModel={state.selectModel} onToggleFavorite={state.toggleFavorite} emptyText={state.emptyText} layout={state.isMobile ? 'mobile' : 'desktop'} />
      )}
    </div>
  )
  const trigger = <ModelSelectorTrigger ref={state.triggerRef} open={state.open} selected={state.selected} disabled={disabled} className={className} displayVariant={variant} selectorSize={size} />

  if (state.isMobile) {
    return (
      <Sheet open={state.open} onOpenChange={state.setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} dialogTitle="选择模型" dialogDescription="按家族浏览、搜索或收藏模型" onCloseAutoFocus={state.restoreTriggerFocus} className="flex h-[min(86dvh,640px)] max-h-[86dvh] flex-col overflow-hidden rounded-t-[16px] border-border bg-surface p-0 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
          {content}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={state.open} onOpenChange={state.setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label="选择模型" portalContainer={state.portalContainer} side={forceBottomDropdown ? 'bottom' : undefined} align={forceBottomDropdown ? 'start' : 'end'} sideOffset={8} onCloseAutoFocus={state.restoreTriggerFocus}
        style={{ height: 'min(496px, var(--radix-popover-content-available-height, 78dvh))' }}
        className="w-[min(600px,calc(100vw-24px))] max-h-[min(78dvh,var(--radix-popover-content-available-height,78dvh))] overflow-hidden rounded-xl border border-border bg-surface p-0">
        {content}
      </PopoverContent>
    </Popover>
  )
}
