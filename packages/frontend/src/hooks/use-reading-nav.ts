'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import {
  READING_ANCHOR_STORAGE_KEY,
  buildTurnOwnership,
  buildTurnTocEntries,
  parseReadingAnchorStore,
  resolveActiveTurnKey,
  serializeReadingAnchorStore,
  shouldShowTurnToc,
  type ReadingAnchorStore,
  type TurnTocEntry,
} from '@/features/chat/reading-nav'
import type { MessageBody, MessageMeta } from '@/types'
import { messageKey } from '@/features/chat/store/utils'
import type { MessageListHandle } from '@/components/message-list'

const messageStorageKey = (id: number | string) => messageKey(id)

interface UseReadingNavParams {
  sessionId: number | null
  metas: MessageMeta[]
  bodies: Record<string, MessageBody>
  scrollAreaRef: MutableRefObject<HTMLDivElement | null>
  messageListApiRef: MutableRefObject<MessageListHandle | null>
  isMessagesLoading: boolean
}

const readStore = (): ReadingAnchorStore => {
  if (typeof window === 'undefined') return {}
  try {
    return parseReadingAnchorStore(window.sessionStorage.getItem(READING_ANCHOR_STORAGE_KEY))
  } catch {
    return {}
  }
}

const writeStore = (store: ReadingAnchorStore) => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(READING_ANCHOR_STORAGE_KEY, serializeReadingAnchorStore(store))
  } catch {
    // ignore quota / private mode
  }
}

export const useReadingNav = ({
  sessionId,
  metas,
  bodies,
  scrollAreaRef,
  messageListApiRef,
  isMessagesLoading,
}: UseReadingNavParams) => {
  const storeRef = useRef<ReadingAnchorStore>({})
  const persistTimerRef = useRef<number | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [scrollable, setScrollable] = useState(false)
  const [pendingRestoreKey, setPendingRestoreKey] = useState<string | null>(null)
  const restoredSessionRef = useRef<number | null>(null)

  const bodyByStorageKey = useMemo(() => {
    const map: Record<string, { content?: string | null }> = {}
    for (const meta of metas) {
      const key = messageStorageKey(meta.id)
      const body = bodies[key]
      if (body) map[key] = body
    }
    return map
  }, [bodies, metas])

  const entries: TurnTocEntry[] = useMemo(
    () => buildTurnTocEntries(metas, bodyByStorageKey),
    [bodyByStorageKey, metas],
  )

  const ownership = useMemo(() => buildTurnOwnership(metas), [metas])

  const visible = shouldShowTurnToc(entries, { scrollable })

  const getScrollViewport = useCallback((): HTMLElement | null => {
    if (!scrollAreaRef.current) return null
    return scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null
  }, [scrollAreaRef])

  const schedulePersist = useCallback(() => {
    if (typeof window === 'undefined') return
    if (persistTimerRef.current !== null) return
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null
      writeStore(storeRef.current)
    }, 120)
  }, [])

  const saveAnchor = useCallback(
    (sid: number | null, messageKeyValue: string | null) => {
      if (sid == null || !messageKeyValue) return
      const prev = storeRef.current[sid]?.messageKey
      if (prev === messageKeyValue) return
      storeRef.current = {
        ...storeRef.current,
        [sid]: { messageKey: messageKeyValue },
      }
      schedulePersist()
    },
    [schedulePersist],
  )

  const updateActiveFromDom = useCallback(() => {
    const viewport = getScrollViewport()
    if (!viewport) return
    setScrollable(viewport.scrollHeight > viewport.clientHeight + 8)

    const vRect = viewport.getBoundingClientRect()
    const nodes = viewport.querySelectorAll<HTMLElement>('[data-reading-key]')
    const positions = Array.from(nodes).map((node) => {
      const rect = node.getBoundingClientRect()
      return {
        key: node.dataset.readingKey || '',
        top: rect.top,
        bottom: rect.bottom,
      }
    }).filter((p) => p.key)

    const nextActive = resolveActiveTurnKey(entries, ownership, positions, {
      viewportTop: vRect.top,
      viewportHeight: vRect.height,
    })
    if (nextActive) {
      setActiveKey(nextActive)
      saveAnchor(sessionId, nextActive)
    }
  }, [entries, getScrollViewport, ownership, saveAnchor, sessionId])

  useEffect(() => {
    storeRef.current = readStore()
  }, [])

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(persistTimerRef.current)
        persistTimerRef.current = null
      }
      writeStore(storeRef.current)
    }
  }, [])

  useEffect(() => {
    if (sessionId == null) {
      setPendingRestoreKey(null)
      setActiveKey(null)
      restoredSessionRef.current = null
      return
    }
    if (restoredSessionRef.current === sessionId) return
    restoredSessionRef.current = sessionId
    const saved = storeRef.current[sessionId]?.messageKey ?? null
    setPendingRestoreKey(saved)
    if (saved) setActiveKey(saved)
  }, [sessionId])

  useEffect(() => {
    if (!pendingRestoreKey) return
    if (isMessagesLoading && metas.length === 0) return
    if (typeof window === 'undefined') return
    if (!messageListApiRef.current) return

    const exists = metas.some((meta) => (meta.stableKey || messageStorageKey(meta.id)) === pendingRestoreKey)
    if (!exists) {
      if (metas.length > 0 && !isMessagesLoading) {
        setPendingRestoreKey(null)
      }
      return
    }

    const frame = window.requestAnimationFrame(() => {
      const ok = messageListApiRef.current?.scrollToStableKey(pendingRestoreKey, { behavior: 'auto' }) ?? false
      if (ok) {
        setPendingRestoreKey(null)
        setActiveKey(pendingRestoreKey)
        saveAnchor(sessionId, pendingRestoreKey)
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isMessagesLoading, messageListApiRef, metas, pendingRestoreKey, saveAnchor, sessionId])

  useEffect(() => {
    const viewport = getScrollViewport()
    if (!viewport) return

    const onScroll = () => updateActiveFromDom()
    onScroll()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)

    return () => {
      viewport.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [getScrollViewport, metas.length, updateActiveFromDom])

  const jumpToKey = useCallback(
    (key: string) => {
      const ok = messageListApiRef.current?.scrollToStableKey(key) ?? false
      if (!ok) return
      setActiveKey(key)
      saveAnchor(sessionId, key)
      // 跳转后 DOM 可能尚未稳定，下一帧再校正高亮
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => updateActiveFromDom())
      }
    },
    [messageListApiRef, saveAnchor, sessionId, updateActiveFromDom],
  )

  return {
    entries,
    activeKey,
    visible,
    jumpToKey,
  }
}
