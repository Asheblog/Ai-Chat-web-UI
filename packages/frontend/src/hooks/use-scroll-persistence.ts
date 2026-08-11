'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  READING_ANCHOR_STORAGE_KEY,
  parseReadingAnchorStore,
} from '@/features/chat/reading-nav'

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96
const AUTO_LOAD_OLDER_TOP_THRESHOLD = 80

const hasSavedReadingAnchor = (sessionId: number | null): boolean => {
  if (sessionId == null || typeof window === 'undefined') return false
  try {
    const store = parseReadingAnchorStore(window.sessionStorage.getItem(READING_ANCHOR_STORAGE_KEY))
    return Boolean(store[sessionId]?.messageKey)
  } catch {
    return false
  }
}

interface UseScrollPersistenceParams {
  currentSessionId: number | null
  sessionMessageMetas: Array<{ id: number | string; role: string }>
  currentSessionPagination: { hasOlder?: boolean; isLoadingOlder?: boolean } | null
  isMessagesLoading: boolean
  isStreaming: boolean
  /** 流式内容版本锚点，由调用方用细粒度 selector 计算，避免订阅完整 messageBodies */
  streamScrollAnchor: string
  loadOlderMessages: (sessionId: number) => Promise<unknown>
}

export const useScrollPersistence = (params: UseScrollPersistenceParams) => {
  const {
    currentSessionId,
    sessionMessageMetas,
    currentSessionPagination,
    isMessagesLoading,
    isStreaming,
    streamScrollAnchor,
    loadOlderMessages,
  } = params

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)
  const autoScrollEnabledRef = useRef(true)
  const prependAnchorRef = useRef<{ sessionId: number; scrollTop: number; scrollHeight: number } | null>(null)
  const loadingOlderRef = useRef(false)

  const setAutoScrollState = useCallback((enabled: boolean) => {
    autoScrollEnabledRef.current = enabled
    setIsAutoScrollEnabled((prev) => (prev === enabled ? prev : enabled))
  }, [])

  const getScrollViewport = useCallback((): HTMLElement | null => {
    if (!scrollAreaRef.current) return null
    return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
  }, [])

  const isNearBottom = useCallback((element: HTMLElement) => {
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    return distance <= AUTO_SCROLL_BOTTOM_THRESHOLD
  }, [])

  const scrollToBottom = useCallback(
    (force = false) => {
      const scrollElement = getScrollViewport()
      if (!scrollElement) return
      if (!force && !autoScrollEnabledRef.current) return
      scrollElement.scrollTop = scrollElement.scrollHeight
      if (!autoScrollEnabledRef.current) {
        setAutoScrollState(true)
      }
    },
    [getScrollViewport, setAutoScrollState],
  )

  useEffect(() => {
    loadingOlderRef.current = false
    prependAnchorRef.current = null
    if (currentSessionId == null) {
      setAutoScrollState(true)
      return
    }
    // 有阅读锚点时先禁止贴底，交给 ReadingAnchor 恢复位置
    setAutoScrollState(!hasSavedReadingAnchor(currentSessionId))
  }, [currentSessionId, setAutoScrollState])

  useEffect(() => {
    const anchor = prependAnchorRef.current
    if (!anchor) return
    if (currentSessionId !== anchor.sessionId) {
      prependAnchorRef.current = null
      return
    }
    if (currentSessionPagination?.isLoadingOlder) return
    const scrollElement = getScrollViewport()
    if (!scrollElement) return
    if (typeof window === 'undefined') return

    const frame = window.requestAnimationFrame(() => {
      const delta = scrollElement.scrollHeight - anchor.scrollHeight
      if (delta > 0) {
        scrollElement.scrollTop = Math.max(0, anchor.scrollTop + delta)
      }
      prependAnchorRef.current = null
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [
    currentSessionId,
    currentSessionPagination?.isLoadingOlder,
    getScrollViewport,
    sessionMessageMetas.length,
  ])

  useEffect(() => {
    const scrollElement = getScrollViewport()
    if (!scrollElement) return

    const updateAutoScrollState = () => {
      setAutoScrollState(isNearBottom(scrollElement))
      if (!currentSessionId) return
      if (isMessagesLoading) return
      if (scrollElement.scrollTop > AUTO_LOAD_OLDER_TOP_THRESHOLD) return
      if (!currentSessionPagination?.hasOlder || currentSessionPagination.isLoadingOlder) return
      if (loadingOlderRef.current) return
      if (prependAnchorRef.current) return

      loadingOlderRef.current = true
      prependAnchorRef.current = {
        sessionId: currentSessionId,
        scrollTop: scrollElement.scrollTop,
        scrollHeight: scrollElement.scrollHeight,
      }
      void loadOlderMessages(currentSessionId).finally(() => {
        loadingOlderRef.current = false
      })
    }

    updateAutoScrollState()
    scrollElement.addEventListener('scroll', updateAutoScrollState, { passive: true })

    return () => {
      scrollElement.removeEventListener('scroll', updateAutoScrollState)
    }
  }, [
    currentSessionId,
    currentSessionPagination?.hasOlder,
    currentSessionPagination?.isLoadingOlder,
    getScrollViewport,
    isMessagesLoading,
    isNearBottom,
    loadOlderMessages,
    setAutoScrollState,
  ])

  useEffect(() => {
    scrollToBottom()
  }, [sessionMessageMetas.length, scrollToBottom])

  useEffect(() => {
    if (!isStreaming) return
    scrollToBottom()
  }, [isStreaming, scrollToBottom, streamScrollAnchor])

  return {
    scrollAreaRef,
    isAutoScrollEnabled,
    scrollToBottom,
    setAutoScrollEnabled: setAutoScrollState,
  }
}
