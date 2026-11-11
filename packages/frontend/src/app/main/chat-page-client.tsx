'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { shallow } from 'zustand/shallow'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ChatInterface } from '@/components/chat-interface'
import { useChatStore } from '@/store/chat-store'
import { prewarmMarkdownWorker } from '@/lib/markdown-worker-client'
import type { ChatSession } from '@/types'

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
  const requestedMessagesForRef = useRef<number | null>(null)

  // 已知路由会话先建立临时会话身份，消息请求不等待 sessions 列表返回。
  // 列表到达后由 ensureSelection 用服务端会话对象替换；权限仍由消息请求自身的鉴权结果决定。
  const provisionalSession = useMemo<ChatSession | null>(() => {
    if (normalizedSessionId === null) return null
    return {
      id: normalizedSessionId,
      userId: -1,
      title: '',
      createdAt: new Date(0).toISOString(),
    }
  }, [normalizedSessionId])

  // 会话初始化阶段就启动 Markdown Worker：弱网下把首包下载与编译提前，
  // 避免第一条消息到达时才撞上初始化等待。
  useEffect(() => {
    prewarmMarkdownWorker()
  }, [])

  useEffect(() => {
    if (normalizedSessionId === null) {
      setIsHydrating(false)
    } else {
      requestedMessagesForRef.current = null
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
        if (requestedMessagesForRef.current === matched.id && state.isMessagesLoading) {
          // 临时身份已发起首个分页；列表返回只更新元数据，等本次请求完成。
          if (state.currentSession?.id !== matched.id || state.currentSession.userId === -1) {
            useChatStore.setState({
              currentSession: matched,
              isStreaming: state.activeStreamSessionId === matched.id,
            })
          }
          return
        }
        // 已知会话在列表返回前已用临时身份加载过消息时，只替换会话元数据，
        // 不重复请求同一会话，避免列表返回后二次加载与闪烁。
        const provisionalLoaded =
          requestedMessagesForRef.current === matched.id || state.messagesHydrated[matched.id] === true
        if (state.currentSession?.id !== matched.id) {
          if (provisionalLoaded) {
            useChatStore.setState({
              currentSession: matched,
              isMessagesLoading: false,
              isStreaming: state.activeStreamSessionId === matched.id,
            })
          } else {
            state.selectSession(matched.id)
          }
        } else if (state.currentSession.userId === -1) {
          // 临时身份与列表命中同一 ID：只替换元数据，保留已发起的消息加载。
          useChatStore.setState({
            currentSession: matched,
            isStreaming: state.activeStreamSessionId === matched.id,
          })
        } else {
          const hasMatchedMessages = state.messageMetas.some((meta) => meta.sessionId === matched.id)
          if (state.isMessagesLoading) return
          if (requestedMessagesForRef.current !== matched.id && state.messagesHydrated[matched.id] !== true) {
            requestedMessagesForRef.current = matched.id
            state.fetchMessages(matched.id)
          } else if (!hasMatchedMessages) {
            if (
              requestedMessagesForRef.current !== matched.id &&
              !useChatStore.getState().isMessagesLoading
            ) {
              requestedMessagesForRef.current = matched.id
              state.fetchMessages(matched.id)
            }
          }
        }
        return
      }

      // sessions 尚未返回时保留临时身份；已加载的消息/加载态不应被清空。
      if (provisionalSession) {
        if (state.currentSession?.id !== provisionalSession.id) {
          useChatStore.setState({
            currentSession: provisionalSession,
            isMessagesLoading: true,
            shareSelection: { enabled: false, sessionId: null, selectedMessageIds: [] },
          })
        }
        const hydrated = state.messagesHydrated[provisionalSession.id] === true
        if (!hydrated && !state.isMessagesLoading && requestedMessagesForRef.current !== provisionalSession.id) {
          requestedMessagesForRef.current = provisionalSession.id
          void state.fetchMessages(provisionalSession.id)
          setIsHydrating(false)
          return
        }
        // 列表与首个消息分页都结束后仍无该会话：视为无效深链，走原有回退。
        // 消息成功（hydrated）时保留临时身份，避免列表分页暂时缺项时误跳转。
        if (hydrated || state.isSessionsLoading || state.isMessagesLoading) {
          setIsHydrating(false)
          return
        }
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
          // 已知会话不等列表：先建立临时身份并请求消息，与 sessions 并行。
          ensureSelection()
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
  }, [fetchSessions, normalizedSessionId, pathname, provisionalSession, router])

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
