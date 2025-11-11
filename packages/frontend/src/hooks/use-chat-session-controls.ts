'use client'

import { useCallback, useMemo } from 'react'
import type { ChatSession } from '@/types'
import type { ModelItem } from '@/store/models-store'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { persistPreferredModel } from '@/store/model-preference-store'

interface UseChatSessionControlsOptions {
  currentSession: ChatSession | null
  canUseWebSearch: boolean
  setThinkingEnabled: (value: boolean) => void
  setWebSearchEnabled: (value: boolean) => void
  setEffort: (value: 'low' | 'medium' | 'high' | 'unset') => void
}

export function useChatSessionControls({
  currentSession,
  canUseWebSearch,
  setThinkingEnabled,
  setWebSearchEnabled,
  setEffort,
}: UseChatSessionControlsOptions) {
  const { actorState, quota } = useAuthStore((state) => ({ actorState: state.actorState, quota: state.quota }))
  const actorType = actorState === 'authenticated' ? 'user' : 'anonymous'
  const isAnonymous = actorState !== 'authenticated'

  const quotaRemaining = useMemo(() => {
    if (!quota) return null
    if (quota.unlimited) return Infinity
    if (typeof quota.remaining === 'number') return quota.remaining
    return Math.max(0, quota.dailyLimit - quota.usedCount)
  }, [quota])

  const quotaExhausted = useMemo(() => {
    if (!quota) return false
    if (!isAnonymous) return false
    if (quotaRemaining === null) return false
    return quotaRemaining <= 0
  }, [isAnonymous, quota, quotaRemaining])

  const quotaLabel = useMemo(() => {
    if (!quota) return null
    if (quota.unlimited) return '无限'
    return Math.max(0, quotaRemaining ?? 0)
  }, [quota, quotaRemaining])

  const basePlaceholder = useMemo(() => {
    if (!quota) return '输入消息（Shift+Enter 换行）'
    if (quotaExhausted) {
      return '额度已用尽，请登录或等待次日重置'
    }
    return `本日消息发送额度剩余 ${quotaLabel}`
  }, [quota, quotaExhausted, quotaLabel])

  const mobilePlaceholder = useMemo(() => {
    return currentSession ? '继续输入...' : '输入你要翻译的文字'
  }, [currentSession])

  const toolbarModelId = useMemo(() => {
    if (!currentSession) return null
    return currentSession.modelLabel || currentSession.modelRawId || null
  }, [currentSession])

  const toggleReasoning = useCallback(
    (value: boolean) => {
      if (!currentSession) return
      setThinkingEnabled(value)
      useChatStore.getState().updateSessionPrefs(currentSession.id, { reasoningEnabled: value })
    },
    [currentSession, setThinkingEnabled],
  )

  const toggleWebSearch = useCallback(
    (value: boolean) => {
      if (!canUseWebSearch) return
      setWebSearchEnabled(value)
    },
    [canUseWebSearch, setWebSearchEnabled],
  )

  const updateEffort = useCallback(
    (value: 'low' | 'medium' | 'high' | 'unset') => {
      if (!currentSession) return
      setEffort(value)
      useChatStore.getState().updateSessionPrefs(currentSession.id, {
        reasoningEffort: value === 'unset' ? undefined : value,
      })
    },
    [currentSession, setEffort],
  )

  const handleModelChange = useCallback(
    (model: ModelItem) => {
      const cur = useChatStore.getState().currentSession
      if (cur) {
        void persistPreferredModel(model, { actorType })
        useChatStore.getState().switchSessionModel(cur.id, model)
      }
    },
    [actorType],
  )

  const quotaNotice = quotaExhausted
    ? {
        message: '匿名额度已用尽，请登录或等待次日额度重置后再试',
      }
    : null

  return {
    actorType,
    quota,
    quotaExhausted,
    quotaLabel,
    basePlaceholder,
    mobilePlaceholder,
    toolbarModelId,
    toggleReasoning,
    toggleWebSearch,
    updateEffort,
    handleModelChange,
    quotaNotice,
  }
}
