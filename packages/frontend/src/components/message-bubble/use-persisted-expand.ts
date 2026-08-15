'use client'

import { useCallback, useEffect, useReducer } from 'react'

export type ExpandSource = 'user' | 'auto' | 'default'

interface ExpandState {
  expanded: boolean
  source: ExpandSource
}

type ExpandAction =
  | { type: 'init'; defaultExpanded: boolean }
  | { type: 'set-default'; defaultExpanded: boolean }
  | { type: 'load-persisted'; expanded: boolean | null }
  | { type: 'auto-expand' }
  | { type: 'hide-if-empty'; hasAnyData: boolean }
  | { type: 'set-user'; expanded: boolean }

export const expandReducer = (state: ExpandState, action: ExpandAction): ExpandState => {
  switch (action.type) {
    case 'init':
      if (state.expanded === action.defaultExpanded && state.source === 'default') return state
      return { expanded: action.defaultExpanded, source: 'default' }
    case 'set-default':
      if (state.source === 'user') return state
      if (state.expanded === action.defaultExpanded && state.source === 'default') return state
      return { expanded: action.defaultExpanded, source: 'default' }
    case 'load-persisted':
      if (action.expanded == null) return state
      if (state.expanded === action.expanded && state.source === 'user') return state
      return { expanded: action.expanded, source: 'user' }
    case 'auto-expand':
      if (state.source === 'user' || state.expanded) return state
      return { expanded: true, source: 'auto' }
    case 'hide-if-empty':
      if (state.source === 'user') return state
      if (action.hasAnyData) return state
      if (!state.expanded && state.source === 'default') return state
      return { expanded: false, source: 'default' }
    case 'set-user':
      if (state.expanded === action.expanded && state.source === 'user') return state
      return { expanded: action.expanded, source: 'user' }
    default:
      return state
  }
}

const STORAGE_LIMIT = 200

interface VisibilityEntry {
  expanded: boolean
  updatedAt: number
}

export const readVisibilityMap = (storageKey: string): Record<string, VisibilityEntry> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, VisibilityEntry>
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // ignore broken JSON and fallback
  }
  return {}
}

export const loadPersistedVisibility = (
  storageKey: string,
  itemKey: string,
): boolean | null => {
  if (!itemKey) return null
  const map = readVisibilityMap(storageKey)
  return typeof map[itemKey]?.expanded === 'boolean' ? map[itemKey].expanded : null
}

export const persistVisibility = (storageKey: string, itemKey: string, expanded: boolean) => {
  if (!itemKey || typeof window === 'undefined') return
  const map = readVisibilityMap(storageKey)
  map[itemKey] = { expanded, updatedAt: Date.now() }
  const entries = Object.entries(map).sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  const pruned = entries.slice(0, STORAGE_LIMIT)
  const next: Record<string, VisibilityEntry> = {}
  for (const [entryKey, entryValue] of pruned) next[entryKey] = entryValue
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(next))
  } catch {
    // storage quota exceeded; best-effort ignore
  }
}

interface UsePersistedExpandOptions {
  storageKey: string
  /** 当前实例的稳定 key，如 `reasoning:{stableKey}`、`tool:{stableKey}:{callId}` */
  itemKey: string
  defaultExpanded?: boolean
  /** 为 true 时自动展开（用户手动状态优先级最高） */
  autoExpand?: boolean
  /** 无数据时自动折叠回默认态 */
  hasData?: boolean
}

export function usePersistedExpand({
  storageKey,
  itemKey,
  defaultExpanded = false,
  autoExpand = false,
  hasData = true,
}: UsePersistedExpandOptions) {
  const [state, dispatch] = useReducer(
    expandReducer,
    { expanded: false, source: 'default' },
    () => expandReducer({ expanded: false, source: 'default' }, { type: 'init', defaultExpanded }),
  )

  // 切换消息/工具实例时重置并恢复该实例的用户记忆
  useEffect(() => {
    dispatch({ type: 'init', defaultExpanded })
    if (itemKey) {
      const persisted = loadPersistedVisibility(storageKey, itemKey)
      dispatch({ type: 'load-persisted', expanded: persisted })
    }
    // defaultExpanded 的后续变化由下面的 set-default 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, storageKey])

  useEffect(() => {
    dispatch({ type: 'set-default', defaultExpanded })
  }, [defaultExpanded])

  useEffect(() => {
    dispatch({ type: 'hide-if-empty', hasAnyData: hasData })
  }, [hasData])

  useEffect(() => {
    if (autoExpand) dispatch({ type: 'auto-expand' })
    else dispatch({ type: 'set-default', defaultExpanded })
  }, [autoExpand, defaultExpanded, itemKey])

  const setExpanded = useCallback(
    (next: boolean) => {
      dispatch({ type: 'set-user', expanded: next })
      if (itemKey) persistVisibility(storageKey, itemKey, next)
    },
    [itemKey, storageKey],
  )

  const toggle = useCallback(() => {
    setExpanded(!state.expanded)
  }, [setExpanded, state.expanded])

  return {
    expanded: state.expanded,
    source: state.source,
    setExpanded,
    toggle,
  }
}
