'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ChatInterface } from '@/components/chat-interface'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  welcomeScreenVariants,
  chatInterfaceVariants,
  pageTransition,
} from '@/lib/animations/page'

interface ChatPageClientProps {
  initialSessionId?: number | null
}

export function ChatPageClient({ initialSessionId = null }: ChatPageClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const redirectedRef = useRef<string | null>(null)
  const { currentSession, fetchSessions } = useChatStore((state) => ({
    currentSession: state.currentSession,
    fetchSessions: state.fetchSessions,
  }))
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)

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
      if (cancelled || normalizedSessionId === null) {
        return
      }

      const state = useChatStore.getState()
      const matched = state.sessions.find((s) => s.id === normalizedSessionId)
      if (matched) {
        if (state.currentSession?.id !== matched.id) {
          state.selectSession(matched.id)
        } else if (state.messageMetas.length === 0) {
          if (state.messagesHydrated[matched.id] !== true) {
            // 防止极端情况下刷新后会话已恢复但消息仍为空
            state.fetchMessages(matched.id)
            state.fetchUsage(matched.id)
          }
        }
        return
      }

      if (state.sessions.length > 0) {
        const fallback = state.sessions[0]
        state.selectSession(fallback.id)
        safeReplace(`/main/${fallback.id}`)
      } else {
        safeReplace('/main')
      }
    }

    void (async () => {
      try {
        if (normalizedSessionId !== null && !cancelled) {
          setIsHydrating(true)
        }
        await fetchSessions()
      } finally {
        ensureSelection()
        if (!cancelled) {
          setIsHydrating(false)
        }
      }
    })()

    fetchSystemSettings()

    return () => {
      cancelled = true
    }
  }, [fetchSessions, fetchSystemSettings, normalizedSessionId, pathname, router])

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {currentSession ? (
          <motion.div
            key="chat-interface"
            variants={chatInterfaceVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <ChatInterface />
          </motion.div>
        ) : isHydrating ? (
          <motion.div
            key="chat-hydrating"
            variants={chatInterfaceVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 flex flex-col h-full min-h-0 items-center justify-center gap-3 text-sm text-muted-foreground"
          >
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-border border-t-primary animate-spin" />
            <span>正在恢复会话…</span>
          </motion.div>
        ) : (
          <motion.div
            key="welcome-screen"
            variants={welcomeScreenVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <WelcomeScreen />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
