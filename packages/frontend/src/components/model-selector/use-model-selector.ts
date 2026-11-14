import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { modelKeyFor } from '@/store/model-preference-store'
import { FAVORITE_MODELS_KEY, RECENT_MODELS_KEY, type CapabilityFilter, type SelectorView } from './model-selector-types'
import { buildModelCollections, isModelSelected, parseStoredModelIds } from './model-selector-utils'

export function useModelSelector(selectedModelId: string | null, onModelChange: (model: ModelItem) => void) {
  const [open, setOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectorView, setSelectorView] = useState<SelectorView>('all')
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>('all')
  const [recentModels, setRecentModels] = useState<string[]>([])
  const [favoriteModels, setFavoriteModels] = useState<string[]>([])
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
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
    setRecentModels(parseStoredModelIds(localStorage.getItem(RECENT_MODELS_KEY)))
    setFavoriteModels(parseStoredModelIds(localStorage.getItem(FAVORITE_MODELS_KEY)))
  }, [])

  useEffect(() => {
    if (!open) { setSearchTerm(''); return }
    const timer = window.setTimeout(() => searchInputRef.current?.focus(), 30)
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
    return () => window.clearTimeout(timer)
  }, [open])

  const selected = useMemo(() => allModels.find(model => isModelSelected(model, selectedModelId)), [allModels, selectedModelId])
  const isSelected = useCallback((model: ModelItem) => isModelSelected(model, selectedModelId), [selectedModelId])
  const selectModel = useCallback((model: ModelItem) => {
    onModelChange(model)
    setRecentModels(current => {
      const key = modelKeyFor(model)
      const next = [key, ...current.filter(id => id !== key)].slice(0, 6)
      try { localStorage.setItem(RECENT_MODELS_KEY, JSON.stringify(next)) }
      catch (error) { console.error('Failed to save recent models:', error) }
      return next
    })
    setOpen(false)
  }, [onModelChange])

  const toggleFavorite = useCallback((modelId: string, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setFavoriteModels(current => {
      const next = current.includes(modelId) ? current.filter(id => id !== modelId) : [...current, modelId]
      try { localStorage.setItem(FAVORITE_MODELS_KEY, JSON.stringify(next)) }
      catch (error) { console.error('Failed to save favorite models:', error) }
      return next
    })
  }, [])

  const collections = useMemo(() => buildModelCollections({
    allModels, searchTerm, selectorView, capabilityFilter, recentModels, favoriteModels, selectedModelId,
  }), [allModels, searchTerm, selectorView, capabilityFilter, recentModels, favoriteModels, selectedModelId])
  const groupNames = useMemo(() => Object.keys(collections.groupedModels), [collections.groupedModels])
  useEffect(() => {
    setActiveGroup(current => {
      if (current && collections.groupedModels[current]) return current
      return groupNames.find(group => collections.groupedModels[group].some(isSelected)) ?? groupNames[0] ?? null
    })
  }, [collections.groupedModels, groupNames, isSelected])

  const emptyText = searchTerm ? '没有匹配的模型，试试其他关键词'
    : selectorView === 'favorites' ? '还没有收藏的模型'
      : selectorView === 'recent' ? '最近没有使用记录'
        : capabilityFilter !== 'all' ? '当前能力筛选下暂无模型' : '暂无可用模型'
  const refresh = useCallback(() => { void fetchAll() }, [fetchAll])
  const restoreTriggerFocus = useCallback((event: Event) => {
    event.preventDefault()
    triggerRef.current?.focus()
  }, [])

  return {
    open, setOpen, searchTerm, setSearchTerm, selectorView, setSelectorView, capabilityFilter, setCapabilityFilter,
    activeGroup, setActiveGroup, isMobile, portalContainer, searchInputRef, triggerRef,
    allModels, loading, error, selected, isSelected, selectModel, toggleFavorite, refresh, restoreTriggerFocus,
    ...collections, emptyText,
    totalConnections: new Set(allModels.map(model => model.connectionId).filter(id => id != null)).size,
    showQuickModels: collections.quickModels.length > 0 && !searchTerm && selectorView === 'all' && capabilityFilter === 'all',
  }
}
