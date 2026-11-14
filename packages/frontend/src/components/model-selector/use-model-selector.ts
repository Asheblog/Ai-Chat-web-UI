import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { filterModels, isModelSelected } from './model-selector-utils'

export function useModelSelector(selectedModelId: string | null, onModelChange: (model: ModelItem) => void) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [isMobile, setIsMobile] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const { models: allModels, isLoading: loading, error, fetchAll } = useModelsStore()

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobile(media.matches)
    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
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
  }, [open])

  const selected = useMemo(() => allModels.find(model => isModelSelected(model, selectedModelId)), [allModels, selectedModelId])
  const isSelected = useCallback((model: ModelItem) => isModelSelected(model, selectedModelId), [selectedModelId])
  const selectModel = useCallback((model: ModelItem) => {
    onModelChange(model)
    setOpen(false)
  }, [onModelChange])
  const visibleModels = useMemo(() => filterModels(allModels, searchTerm), [allModels, searchTerm])
  const refresh = useCallback(() => {
    if (!loading) void fetchAll()
  }, [fetchAll, loading])
  const focusSearch = useCallback((event: Event) => {
    event.preventDefault()
    searchInputRef.current?.focus()
  }, [])
  const restoreTriggerFocus = useCallback((event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }, [])

  return {
    open, setOpen, searchTerm, setSearchTerm, isMobile, portalContainer, searchInputRef, triggerRef,
    allModels, loading, error, selected, isSelected, selectModel, refresh, focusSearch, restoreTriggerFocus,
    visibleModels, hasSearch: searchTerm.trim().length > 0,
  }
}
