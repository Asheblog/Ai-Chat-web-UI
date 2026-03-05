'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { messageKey as toMessageKey } from '@/features/chat/store/utils'

const AUTO_SCROLL_BOTTOM_THRESHOLD = 96
const AUTO_LOAD_OLDER_TOP_THRESHOLD = 80
const SESSION_SCROLL_STORAGE_KEY = 'aichat:chat-session-scroll'

const readSessionScrollState = (): Record<number, number> => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.sessionStorage.getItem(SESSION_SCROLL_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const next: Record<number, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const sessionId = Number.parseInt(key, 10)
      const top = Number(value)
      if (!Number.isFinite(sessionId) || !Number.isFinite(top)) continue
      next[sessionId] = Math.max(0, Math.floor(top))
    }
    return next
  } catch {
    return {}
  }
}

const writeSessionScrollState = (state: Record<number, number>) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(SESSION_SCROLL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore
  }
}

interface UseScrollPersistenceParams {
  currentSessionId: number | null
  sessionMessageMetas: Array<{ id: number | string; role: string }>
  currentSessionPagination: { hasOlder?: boolean; isLoadingOlder?: boolean } | null
  isMessagesLoading: boolean
  isStreaming: boolean
  messageBodies: Record<string, { version?: number; reasoningVersion?: number } | undefined>
  loadOlderMessages: (sessionId: number) => Promise<unknown>
}

export const useScrollPersistence = (params: UseScrollPersistenceParams) => {
  const {
    currentSessionId,
    sessionMessageMetas,
    currentSessionPagination,
    isMessagesLoading,
    isStreaming,
    messageBodies,
    loadOlderMessages,
  } = params

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true)
  const autoScrollEnabledRef = useRef(true)
  const scrollStateRef = useRef<Record<number, number>>({})
  const scrollPersistTimerRef = useRef<number | null>(null)
  const pendingRestoreSessionRef = useRef<number | null>(null)
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

  const persistScrollState = useCallback(() => {
    writeSessionScrollState(scrollStateRef.current)
  }, [])

  const schedulePersistScrollState = useCallback(() => {
    if (typeof window === 'undefined') return
    if (scrollPersistTimerRef.current !== null) return
    scrollPersistTimerRef.current = window.setTimeout(() => {
      scrollPersistTimerRef.current = null
      persistScrollState()
    }, 120)
  }, [persistScrollState])

  const saveSessionScrollTop = useCallback(
    (sessionId: number | null, top: number) => {
      if (sessionId == null) return
      if (!Number.isFinite(top)) return
      const normalized = Math.max(0, Math.floor(top))
      if (scrollStateRef.current[sessionId] === normalized) return
      scrollStateRef.current = {
        ...scrollStateRef.current,
        [sessionId]: normalized,
      }
      schedulePersistScrollState()
    },
    [schedulePersistScrollState],
  )

  useEffect(() => {
    scrollStateRef.current = readSessionScrollState()
  }, [])

  useEffect(() => {
    return () => {
      if (scrollPersistTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(scrollPersistTimerRef.current)
        scrollPersistTimerRef.current = null
      }
      persistScrollState()
    }
  }, [persistScrollState])

  useEffect(() => {
    pendingRestoreSessionRef.current = currentSessionId
    loadingOlderRef.current = false
    prependAnchorRef.current = null
    if (currentSessionId == null) return
    const savedTop = scrollStateRef.current[currentSessionId]
    if (Number.isFinite(savedTop)) {
      setAutoScrollState(false)
    } else {
      setAutoScrollState(true)
    }
  }, [currentSessionId, setAutoScrollState])

  useEffect(() => {
    if (currentSessionId == null) return
    if (pendingRestoreSessionRef.current !== currentSessionId) return

    const scrollElement = getScrollViewport()
    if (!scrollElement) return
    if (isMessagesLoading && sessionMessageMetas.length === 0) return

    pendingRestoreSessionRef.current = null
    const savedTop = scrollStateRef.current[currentSessionId]
    const hasSavedTop = Number.isFinite(savedTop)
    if (typeof window === 'undefined') return

    const frame = window.requestAnimationFrame(() => {
      const maxTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
      const targetTop = hasSavedTop
        ? Math.max(0, Math.min(Number(savedTop), maxTop))
        : maxTop
      scrollElement.scrollTop = targetTop
      saveSessionScrollTop(currentSessionId, scrollElement.scrollTop)
      setAutoScrollState(isNearBottom(scrollElement))
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [
    currentSessionId,
    getScrollViewport,
    isMessagesLoading,
    isNearBottom,
    saveSessionScrollTop,
    sessionMessageMetas.length,
    setAutoScrollState,
  ])

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
        saveSessionScrollTop(anchor.sessionId, scrollElement.scrollTop)
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
    saveSessionScrollTop,
    sessionMessageMetas.length,
  ])

  useEffect(() => {
    return () => {
      const scrollElement = getScrollViewport()
      if (!scrollElement || currentSessionId == null) return
      saveSessionScrollTop(currentSessionId, scrollElement.scrollTop)
    }
  }, [currentSessionId, getScrollViewport, saveSessionScrollTop])

  useEffect(() => {
    const scrollElement = getScrollViewport()
    if (!scrollElement) return

    const updateAutoScrollState = () => {
      setAutoScrollState(isNearBottom(scrollElement))
      saveSessionScrollTop(currentSessionId, scrollElement.scrollTop)
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
    saveSessionScrollTop,
    setAutoScrollState,
  ])

  useEffect(() => {
    scrollToBottom()
  }, [sessionMessageMetas.length, scrollToBottom])

  const streamScrollAnchor = useMemo(() => {
    if (!isStreaming || sessionMessageMetas.length === 0) return 'idle'
    const lastMeta = sessionMessageMetas[sessionMessageMetas.length - 1]
    if (!lastMeta || lastMeta.role !== 'assistant') {
      return `stream:${sessionMessageMetas.length}`
    }
    const key = toMessageKey(lastMeta.id)
    const body = messageBodies[key]
    return `stream:${key}:${body?.version ?? 0}:${body?.reasoningVersion ?? 0}`
  }, [isStreaming, messageBodies, sessionMessageMetas])

  useEffect(() => {
    if (!isStreaming) return
    scrollToBottom()
  }, [isStreaming, scrollToBottom, streamScrollAnchor])

  return {
    scrollAreaRef,
    isAutoScrollEnabled,
    scrollToBottom,
  }
}
