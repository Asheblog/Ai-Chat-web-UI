/**
 * 知识库状态管理 Hook
 * 用于在聊天界面管理知识库的选择和使用
 */

import { useCallback, useEffect, useState } from 'react'
import { apiHttpClient } from '@/lib/api'
import type { ApiResponse } from '@/types'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

export interface KnowledgeBaseItem {
  id: number
  name: string
  description: string | null
  documentCount: number
  totalChunks: number
  status: 'active' | 'disabled'
}

interface UseKnowledgeBaseOptions {
  /** 会话 ID，用于持久化选择（可选） */
  sessionId?: number | null
}

export interface UseKnowledgeBaseReturn {
  /** 可用知识库列表 */
  availableKbs: KnowledgeBaseItem[]
  /** 当前选中的知识库 ID 列表 */
  selectedKbIds: number[]
  /** 知识库功能是否启用 */
  isEnabled: boolean
  /** 当前用户是否有权限使用知识库 */
  hasPermission: boolean
  /** 是否正在加载 */
  isLoading: boolean
  /** 错误信息 */
  error: string | null
  /** 切换选择某个知识库 */
  toggleKb: (id: number) => void
  /** 设置选中的知识库 */
  setSelectedKbIds: (ids: number[]) => void
  /** 全选 */
  selectAll: () => void
  /** 取消全选 */
  clearAll: () => void
  /** 刷新列表 */
  refresh: () => Promise<void>
}

/**
 * 知识库状态管理 Hook
 */
export function useKnowledgeBase(options: UseKnowledgeBaseOptions = {}): UseKnowledgeBaseReturn {
  const { sessionId } = options

  const [availableKbs, setAvailableKbs] = useState<KnowledgeBaseItem[]>([])
  const [selectedKbIds, setSelectedKbIds] = useState<number[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 获取用户状态
  const { actorState, user } = useAuthStore((state) => ({
    actorState: state.actorState,
    user: state.user,
  }))

  // 获取系统设置
  const { systemSettings } = useSettingsStore((state) => ({
    systemSettings: state.systemSettings,
  }))

  const isAnonymous = actorState !== 'authenticated'
  const isAdmin = actorState === 'authenticated' && user?.role === 'ADMIN'

  // 判断功能是否启用
  const knowledgeBaseEnabled = Boolean((systemSettings as any)?.knowledgeBaseEnabled ?? false)
  const knowledgeBaseAllowAnonymous = Boolean((systemSettings as any)?.knowledgeBaseAllowAnonymous ?? false)
  const knowledgeBaseAllowUsers = Boolean((systemSettings as any)?.knowledgeBaseAllowUsers ?? true)

  // 判断用户权限
  const hasPermission = (() => {
    if (!knowledgeBaseEnabled) return false
    if (isAdmin) return true
    if (isAnonymous && !knowledgeBaseAllowAnonymous) return false
    if (!isAnonymous && !knowledgeBaseAllowUsers) return false
    return true
  })()

  const isEnabled = knowledgeBaseEnabled && hasPermission

  // 从 sessionStorage 恢复选择
  const storageKey = sessionId ? `kb-selected-${sessionId}` : 'kb-selected-draft'

  const readStoredSelection = useCallback((): number[] => {
    if (typeof window === 'undefined') return []
    try {
      const raw = sessionStorage.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((id) => typeof id === 'number')
      }
      return []
    } catch {
      return []
    }
  }, [storageKey])

  const writeStoredSelection = useCallback(
    (ids: number[]) => {
      if (typeof window === 'undefined') return
      try {
        if (ids.length === 0) {
          sessionStorage.removeItem(storageKey)
        } else {
          sessionStorage.setItem(storageKey, JSON.stringify(ids))
        }
      } catch {
        // ignore storage error
      }
    },
    [storageKey]
  )

  // 加载知识库列表
  const fetchKnowledgeBases = useCallback(async () => {
    if (!isEnabled) {
      setAvailableKbs([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const res = await apiHttpClient.get<ApiResponse<KnowledgeBaseItem[]>>('/knowledge-bases')
      if (res.data.success && Array.isArray(res.data.data)) {
        // 只显示 active 状态的知识库
        const activeKbs = res.data.data.filter((kb) => kb.status === 'active')
        setAvailableKbs(activeKbs)
      } else {
        setAvailableKbs([])
      }
    } catch (err: any) {
      console.error('[useKnowledgeBase] Failed to fetch:', err)
      setError(err?.message || '加载知识库列表失败')
      setAvailableKbs([])
    } finally {
      setIsLoading(false)
    }
  }, [isEnabled])

  // 初始化加载
  useEffect(() => {
    if (isEnabled) {
      fetchKnowledgeBases()
      // 恢复之前的选择
      const stored = readStoredSelection()
      if (stored.length > 0) {
        setSelectedKbIds(stored)
      }
    } else {
      setAvailableKbs([])
      setSelectedKbIds([])
    }
  }, [isEnabled, fetchKnowledgeBases, readStoredSelection])

  // 同步选择到 storage
  useEffect(() => {
    writeStoredSelection(selectedKbIds)
  }, [selectedKbIds, writeStoredSelection])

  // 验证选中的 ID 在可用列表中
  useEffect(() => {
    if (availableKbs.length > 0 && selectedKbIds.length > 0) {
      const validIds = selectedKbIds.filter((id) => 
        availableKbs.some((kb) => kb.id === id)
      )
      if (validIds.length !== selectedKbIds.length) {
        setSelectedKbIds(validIds)
      }
    }
  }, [availableKbs, selectedKbIds])

  const toggleKb = useCallback((id: number) => {
    setSelectedKbIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((kbId) => kbId !== id)
      }
      return [...prev, id]
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedKbIds(availableKbs.map((kb) => kb.id))
  }, [availableKbs])

  const clearAll = useCallback(() => {
    setSelectedKbIds([])
  }, [])

  const refresh = useCallback(async () => {
    await fetchKnowledgeBases()
  }, [fetchKnowledgeBases])

  return {
    availableKbs,
    selectedKbIds,
    isEnabled,
    hasPermission,
    isLoading,
    error,
    toggleKb,
    setSelectedKbIds,
    selectAll,
    clearAll,
    refresh,
  }
}
