'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { shallow } from 'zustand/shallow'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ChatInterface } from '@/components/chat-interface'
import { useChatStore } from '@/store/chat-store'

interface ChatPageClientProps {
  initialSessionId?: number | null
}

export function ChatPageClient({ initialSessionId = null }: ChatPageClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const redirectedRef = useRef<string | null>(null)
  const { currentSession, fetchSessions } = useChatStore(
    (state) => ({
      currentSession: state.currentSession,
      fetchSessions: state.fetchSessions,
    }),
    shallow,
  )

  const normalizedSessionId =
    typeof initialSessionId === 'number' && Number.isFinite(initialSessionId)
      ? initialSessionId
      : null
  const [isHydrating, setIsHydrating] = useState<boolean>(() => normalizedSessionId !== null)

  useEffect(() => {
    if (normalizedSessionId === null) {
      setIsHydrating(false)
    }
  }, [normalizedSessionId])

  useEffect(() => {
    redirectedRef.current = null
  }, [pathname])

  useEffect(() => {
    let cancelled = false

    const safeReplace = (target: string) => {
      const currentPath =
        typeof window !== 'undefined' ? window.location.pathname : pathname
      if (currentPath === target) {
        redirectedRef.current = null
        return
      }
      if (redirectedRef.current === target) return
      redirectedRef.current = target
      router.replace(target)
    }

    const ensureSelection = () => {
      if (cancelled) return
      if (normalizedSessionId === null) {
        const state = useChatStore.getState()
        if (state.currentSession !== null) {
          state.clearCurrentSession()
        }
        return
      }

      const state = useChatStore.getState()
      const matched = state.sessions.find((s) => s.id === normalizedSessionId)
      if (matched) {
        if (state.currentSession?.id !== matched.id) {
          state.selectSession(matched.id)
        } else {
          const hasMatchedMessages = state.messageMetas.some((meta) => meta.sessionId === matched.id)
          if (state.messagesHydrated[matched.id] !== true) {
            state.fetchMessages(matched.id)
          } else if (!hasMatchedMessages) {
            state.fetchMessages(matched.id)
          }
        }
        return
      }

      if (state.sessions.length > 0) {
        const fallback = state.sessions[0]
        state.selectSession(fallback.id)
        safeReplace(`/main/${fallback.id}`)
      } else if (!state.isSessionsLoading) {
        safeReplace('/main')
      }
    }

    void (async () => {
      try {
        if (normalizedSessionId !== null && !cancelled) {
          const hasSessions = useChatStore.getState().sessions.length > 0
          setIsHydrating(!hasSessions)
        }
        // bootstrap 负责预热；此处仅在仍为空时走 store 内 in-flight 去重 ensure。
        // 禁止把 isSessionsLoading / sessions.length 放进 deps：空列表时 fetchSessions
        // 会翻转 loading，从而反复触发本 effect → /sessions + /sessions/usage 死循环。
        if (useChatStore.getState().sessions.length === 0) {
          await fetchSessions()
        }
      } finally {
        ensureSelection()
        if (!cancelled) {
          setIsHydrating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fetchSessions, normalizedSessionId, pathname, router])

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      {currentSession ? (
        <div key="chat-interface" className="flex-1 flex flex-col h-full min-h-0">
          <ChatInterface />
        </div>
      ) : isHydrating ? (
        <div
          key="chat-hydrating"
          className="flex-1 flex flex-col h-full min-h-0 items-center justify-center gap-3 text-sm text-muted-foreground"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-border border-t-primary animate-spin" />
          <span>正在恢复会话…</span>
        </div>
      ) : (
        <div key="welcome-screen" className="flex-1 flex flex-col h-full min-h-0">
          <WelcomeScreen />
        </div>
      )}
    </div>
  )
}
