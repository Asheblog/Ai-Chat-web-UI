"use client"

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import type { ModelSelectorProps } from './model-selector-types'
import { ModelSelectorList } from './model-selector-list'
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
      <ModelSelectorHeader loading={state.loading} error={state.error} hasModels={state.allModels.length > 0} onRefresh={state.refresh} onClose={() => state.setOpen(false)} />
      <ModelSelectorSearchControls searchTerm={state.searchTerm} onSearchTermChange={state.setSearchTerm} searchInputRef={state.searchInputRef} />
      {!(state.error && state.allModels.length === 0 && !state.loading) && (
        <ModelSelectorList loading={state.loading && state.allModels.length === 0} models={state.visibleModels} isModelSelected={state.isSelected} onSelectModel={state.selectModel} hasSearch={state.hasSearch} onRefresh={state.refresh} />
      )}
      <div className="shrink-0 border-t border-border px-5 py-3 text-xs leading-4 text-muted-foreground" aria-hidden="true">
        {state.isMobile ? '点选立即使用' : '↑ ↓ 选择　Enter 使用　Esc 关闭'}
      </div>
    </div>
  )
  const trigger = <ModelSelectorTrigger ref={state.triggerRef} open={state.open} selected={state.selected} disabled={disabled} className={className} displayVariant={variant} selectorSize={size} />

  if (state.isMobile) {
    return (
      <Sheet open={state.open} onOpenChange={state.setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} dialogTitle="选择模型" dialogDescription="搜索模型或供应商，点选立即使用" onOpenAutoFocus={state.focusSearch} onCloseAutoFocus={state.restoreTriggerFocus} className="flex h-[min(78dvh,640px)] max-h-[86dvh] flex-col overflow-hidden rounded-t-[16px] border-border bg-surface p-0 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
          {content}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={state.open} onOpenChange={state.setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label="选择模型" portalContainer={state.portalContainer} side={forceBottomDropdown ? 'bottom' : undefined} align={forceBottomDropdown ? 'start' : 'end'} sideOffset={8} onOpenAutoFocus={state.focusSearch} onCloseAutoFocus={state.restoreTriggerFocus}
        style={{ height: 'min(540px, var(--radix-popover-content-available-height, 78dvh))' }}
        className="w-[min(464px,calc(100vw-24px))] max-h-[min(78dvh,var(--radix-popover-content-available-height,78dvh))] overflow-hidden rounded-xl border border-border bg-surface p-0">
        {content}
      </PopoverContent>
    </Popover>
  )
}
