'use client'

import { useCallback, useMemo } from 'react'
import { shallow } from 'zustand/shallow'
import { useChatStore } from '@/store/chat-store'
import { messageKey as toMessageKey } from '@/features/chat/store/utils'
import { useScrollPersistence } from './use-scroll-persistence'

/**
 * 消息视口独立订阅：只有列表顺序/分页/滚动锚点变化时才重算；
 * 输入与 composer 状态不会穿过这层边界。
 */
export function useChatViewport() {
  const {
    currentSession,
    messageMetas,
    messagePaginationBySession,
    isMessagesLoading,
    isStreaming,
    loadOlderMessages,
    assistantVariantSelections,
    error,
  } = useChatStore(
    (state) => ({
      currentSession: state.currentSession,
      messageMetas: state.messageMetas,
      messagePaginationBySession: state.messagePaginationBySession,
      isMessagesLoading: state.isMessagesLoading,
      isStreaming: state.isStreaming,
      loadOlderMessages: state.loadOlderMessages,
      assistantVariantSelections: state.assistantVariantSelections,
      error: state.error,
    }),
    shallow,
  )

  const sessionMessageMetas = useMemo(() => {
    if (!currentSession) return []
    return messageMetas.filter((meta) => meta.sessionId === currentSession.id)
  }, [messageMetas, currentSession])

  const streamScrollAnchor = useChatStore((state) => {
    if (!state.isStreaming || !currentSession) return 'idle'
    const sessionMetas = state.messageMetas.filter((meta) => meta.sessionId === currentSession.id)
    if (sessionMetas.length === 0) return 'idle'
    const lastMeta = sessionMetas[sessionMetas.length - 1]
    if (!lastMeta || lastMeta.role !== 'assistant') {
      return `stream:${sessionMetas.length}`
    }
    const key = toMessageKey(lastMeta.id)
    const body = state.messageBodies[key]
    return `stream:${key}:${body?.version ?? 0}:${body?.reasoningVersion ?? 0}`
  }, shallow)

  const currentSessionPagination = useMemo(() => {
    if (!currentSession) return null
    return messagePaginationBySession[currentSession.id] || null
  }, [messagePaginationBySession, currentSession])
  const hasOlderMessages = Boolean(currentSessionPagination?.hasOlder)
  const isLoadingOlderMessages = Boolean(currentSessionPagination?.isLoadingOlder)

  const { scrollAreaRef, isAutoScrollEnabled, setAutoScrollEnabled, scrollToBottom } =
    useScrollPersistence({
      currentSessionId: currentSession?.id ?? null,
      sessionMessageMetas,
      currentSessionPagination,
      isMessagesLoading,
      isStreaming,
      streamScrollAnchor,
      loadOlderMessages,
    })

  const setAutoScrollEnabledState = useCallback(
    (enabled: boolean) => setAutoScrollEnabled(enabled),
    [setAutoScrollEnabled],
  )

  return {
    currentSession,
    error,
    messageMetas: sessionMessageMetas,
    assistantVariantSelections,
    isMessagesLoading,
    isStreaming,
    hasOlderMessages,
    isLoadingOlderMessages,
    scrollAreaRef,
    isAutoScrollEnabled,
    setAutoScrollEnabled: setAutoScrollEnabledState,
    scrollToBottom,
  }
}
