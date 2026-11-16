"use client"

import type { ModelSelectorProps } from './model-selector-types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { ModelSelectorEffortFooter, ModelSelectorEffortList } from './model-selector-effort'
import { ModelSelectorList } from './model-selector-list'
import { ModelSelectorSearchControls } from './model-selector-search-controls'
import { ModelSelectorTrigger } from './model-selector-trigger'
import { ModelSelectorHeader } from './model-selector-header'
import { handleModelSelectorKeyDown } from './model-selector-keyboard'
import { useModelSelector } from './use-model-selector'

export function ModelSelector({
  selectedModelId, onModelChange, disabled, className, variant = 'default', size = 'md',
  dropdownDirection = 'auto', reasoningControl, open, onOpenChange, defaultView, formatTriggerName,
}: ModelSelectorProps) {
  const state = useModelSelector({ selectedModelId, onModelChange, reasoningControl, open, onOpenChange, defaultView })
  const forceBottomDropdown = dropdownDirection === 'bottom'
  const combined = Boolean(reasoningControl)
  const showList = !(state.error && state.allModels.length === 0 && !state.loading)
  const title = state.view === 'effort' ? '思考强度' : combined ? '模型与思考' : '选择模型'
  const content = (
    <div className="flex min-h-0 flex-1 flex-col bg-surface" onKeyDown={handleModelSelectorKeyDown}>
      <ModelSelectorHeader
        view={state.view} title={title} loading={state.loading} error={state.error}
        hasModels={state.allModels.length > 0} onRefresh={state.refresh}
        onClose={() => state.setOpen(false)} onBack={state.showModels}
      />
      {state.view === 'effort' && reasoningControl ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <p className="shrink-0 truncate px-4 pb-2 text-xs leading-4 text-muted-foreground" title={state.selected?.name}>
            {state.selected?.name ?? '未选择模型'}
          </p>
          <ModelSelectorEffortList
            value={reasoningControl.value}
            disabled={reasoningControl.disabled}
            onChange={state.selectEffort}
            availableEfforts={state.selected?.efforts}
          />
        </div>
      ) : (
        <>
          <ModelSelectorSearchControls searchTerm={state.searchTerm} onSearchTermChange={state.setSearchTerm} searchInputRef={state.searchInputRef} />
          {showList && (
            <ModelSelectorList
              loading={state.loading && state.allModels.length === 0} models={state.visibleModels}
              isModelSelected={state.isSelected} onSelectModel={state.selectModel}
              hasSearch={state.hasSearch} onRefresh={state.refresh}
            />
          )}
          {reasoningControl && (
            <ModelSelectorEffortFooter
              value={reasoningControl.value}
              disabled={reasoningControl.disabled}
              disabledReason={reasoningControl.disabledReason}
              onOpen={state.showEffort}
            />
          )}
        </>
      )}
    </div>
  )
  const trigger = (
    <ModelSelectorTrigger
      ref={state.triggerRef} open={state.open} selected={state.selected} disabled={disabled}
      className={className} displayVariant={variant} selectorSize={size} effort={reasoningControl?.value}
      formatTriggerName={formatTriggerName}
    />
  )

  if (state.isMobile) {
    return (
      <Sheet open={state.open} onOpenChange={state.setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} dialogTitle={combined ? '模型与思考' : '选择模型'} dialogDescription={combined ? '搜索模型或供应商；底部可调整思考强度' : '搜索模型或供应商，点选立即使用'} onOpenAutoFocus={state.focusInitial} onCloseAutoFocus={state.restoreTriggerFocus} style={{ bottom: 'var(--app-keyboard-inset, 0px)' }} className="flex h-[min(calc(var(--app-visible-height,100dvh)*0.78),640px)] max-h-[calc(var(--app-visible-height,100dvh)*0.86)] flex-col overflow-hidden rounded-t-[16px] border-border bg-surface p-0 pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto mb-1 mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden="true" />
          {content}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Popover open={state.open} onOpenChange={state.setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent aria-label="选择模型" portalContainer={state.portalContainer}
        side={forceBottomDropdown ? 'bottom' : 'top'} align={forceBottomDropdown ? 'start' : 'end'} sideOffset={8}
        onOpenAutoFocus={state.focusInitial} onCloseAutoFocus={state.restoreTriggerFocus}
        className="flex w-[min(288px,calc(100vw-24px))] max-h-[min(60dvh,var(--radix-popover-content-available-height,60dvh))] flex-col overflow-hidden rounded-xl border border-border bg-surface p-0">
        {content}
        {!combined && <div className="shrink-0 border-t border-border px-3 py-2 text-xs text-muted-foreground">↑ ↓ 移动 · Enter 选择 · Esc 关闭</div>}
      </PopoverContent>
    </Popover>
  )
}
