import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import type { ModelReasoningControl, ModelReasoningEffort, ModelSelectorView } from './model-selector-types'
import { filterModels, isModelSelected } from './model-selector-utils'

interface UseModelSelectorOptions {
  selectedModelId: string | null
  onModelChange: (model: ModelItem) => void
  reasoningControl?: ModelReasoningControl
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultView?: ModelSelectorView
}

export function useModelSelector({
  selectedModelId, onModelChange, reasoningControl, open: openProp, onOpenChange, defaultView = 'models',
}: UseModelSelectorOptions) {
  const [openState, setOpenState] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [view, setView] = useState<ModelSelectorView>(defaultView)
  const [isMobile, setIsMobile] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { models: allModels, isLoading: loading, error, fetchAll } = useModelsStore()

  const open = openProp ?? openState
  const setOpen = useCallback((next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }, [openProp, onOpenChange])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    setView(defaultView)
    if (!open) { setSearchTerm(''); return }
    let current: HTMLElement | null = triggerRef.current
    let scrollable: HTMLElement | null = null
    while (current) {
      if (['auto', 'scroll', 'overlay'].includes(window.getComputedStyle(current).overflowY)) {
        scrollable = current
        break
      }
      current = current.parentElement
    }
    setPortalContainer(scrollable)
  }, [open, defaultView])

  // 视图切换后焦点跟随新视图的主控件，避免焦点留在已卸载的节点上。
  useEffect(() => {
    if (!open || view !== 'models') return
    searchInputRef.current?.focus()
  }, [open, view])

  const selected = useMemo(() => allModels.find(model => isModelSelected(model, selectedModelId)), [allModels, selectedModelId])
  const isSelected = useCallback((model: ModelItem) => isModelSelected(model, selectedModelId), [selectedModelId])
  const selectModel = useCallback((model: ModelItem) => {
    onModelChange(model)
    // 组合模式保留面板以便继续调整强度；纯模型入口保持选择即关闭。
    if (!reasoningControl) setOpen(false)
  }, [onModelChange, reasoningControl, setOpen])
  const selectEffort = useCallback((value: ModelReasoningEffort) => {
    reasoningControl?.onChange(value)
    setView('models')
  }, [reasoningControl])
  const showEffort = useCallback(() => setView('effort'), [])
  const showModels = useCallback(() => setView('models'), [])
  const visibleModels = useMemo(() => filterModels(allModels, searchTerm), [allModels, searchTerm])
  const refresh = useCallback(() => {
    if (!loading) void fetchAll()
  }, [fetchAll, loading])
  const focusInitial = useCallback((event?: Event) => {
    event?.preventDefault()
    // 强度视图挂载时自行聚焦当前项；模型视图把焦点交给搜索。
    if (view === 'effort') return
    searchInputRef.current?.focus()
  }, [view])
  const restoreTriggerFocus = useCallback((event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }, [])

  return {
    open, setOpen, searchTerm, setSearchTerm, isMobile, portalContainer, searchInputRef, triggerRef,
    allModels, loading, error, selected, isSelected, selectModel, refresh, focusInitial, restoreTriggerFocus,
    visibleModels, hasSearch: searchTerm.trim().length > 0,
    view, selectEffort, showEffort, showModels,
  }
}
