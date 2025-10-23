import { create } from 'zustand'
import { ChatState, ChatSession, Message } from '@/types'
import { apiClient } from '@/lib/api'

interface ChatStore extends ChatState {
  fetchSessions: () => Promise<void>
  fetchSessionsUsage: () => Promise<void>
  fetchMessages: (sessionId: number) => Promise<void>
  fetchUsage: (sessionId: number) => Promise<void>
  createSession: (modelId: string, title?: string) => Promise<void>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  updateSessionPrefs: (sessionId: number, prefs: Partial<{ reasoningEnabled: boolean; reasoningEffort: 'low'|'medium'|'high'; ollamaThink: boolean }>) => Promise<void>
  sendMessage: (sessionId: number, content: string) => Promise<void>
  streamMessage: (sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean }) => Promise<void>
  stopStreaming: () => void
  addMessage: (message: Message) => void
  clearError: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  usageCurrent: null,
  usageLastRound: null,
  usageTotals: null,
  // sessionId -> totals
  sessionUsageTotalsMap: {} as Record<number, import('@/types').UsageTotals>,

  fetchSessions: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.getSessions()
      set({
        sessions: response.data || [],
        isLoading: false,
      })
      // 同步拉取会话用量（聚合）
      get().fetchSessionsUsage().catch(() => {})
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '获取会话列表失败',
        isLoading: false,
      })
    }
  },

  fetchSessionsUsage: async () => {
    try {
      const res = await apiClient.getSessionsUsage()
      const arr = res.data as Array<{ sessionId: number; totals: import('@/types').UsageTotals }>
      const map: Record<number, import('@/types').UsageTotals> = {}
      ;(arr || []).forEach(item => { map[item.sessionId] = item.totals })
      set({ sessionUsageTotalsMap: map })
    } catch (error) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[fetchSessionsUsage] error', (error as any)?.message || error)
      }
    }
  },

  fetchMessages: async (sessionId: number) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.getMessages(sessionId)
      set({
        messages: response.data || [],
        isLoading: false,
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '获取消息列表失败',
        isLoading: false,
      })
    }
  },

  fetchUsage: async (sessionId: number) => {
    try {
      const res = await apiClient.getUsage(sessionId)
      const data = res.data || {}
      set({
        usageTotals: data.totals || null,
        usageLastRound: data.last_round || null,
        usageCurrent: data.current || null,
      })
    } catch (error: any) {
      // 忽略错误，但在调试输出
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.debug('[fetchUsage] error', error?.message || error)
      }
    }
  },

  createSession: async (modelId: string, title?: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.createSessionByModelId(modelId, title)
      const newSession = response.data

      set((state) => ({
        sessions: [newSession, ...state.sessions],
        currentSession: newSession,
        messages: [],
        isLoading: false,
      }))
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '创建会话失败',
        isLoading: false,
      })
    }
  },

  selectSession: (sessionId: number) => {
    const { sessions } = get()
    const session = sessions.find(s => s.id === sessionId)
    if (session) {
      set({
        currentSession: session,
        messages: [],
        usageCurrent: null,
        usageLastRound: null,
        usageTotals: null,
      })
      // 自动加载该会话的消息
      get().fetchMessages(sessionId)
      // 预取 usage 聚合
      get().fetchUsage(sessionId)
    }
  },

  deleteSession: async (sessionId: number) => {
    try {
      await apiClient.deleteSession(sessionId)
      set((state) => {
        const newSessions = state.sessions.filter(s => s.id !== sessionId)
        const shouldClearCurrent = state.currentSession?.id === sessionId

        return {
          sessions: newSessions,
          currentSession: shouldClearCurrent ? null : state.currentSession,
          messages: shouldClearCurrent ? [] : state.messages,
        }
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '删除会话失败',
      })
    }
  },

  updateSessionTitle: async (sessionId: number, title: string) => {
    try {
      await apiClient.updateSession(sessionId, { title })
      set((state) => ({
        sessions: state.sessions.map(session =>
          session.id === sessionId ? { ...session, title } : session
        ),
        currentSession: state.currentSession?.id === sessionId
          ? { ...state.currentSession, title }
          : state.currentSession,
      }))
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '更新会话标题失败',
      })
    }
  },

  updateSessionPrefs: async (sessionId, prefs) => {
    try {
      await apiClient.updateSession(sessionId, prefs as any)
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, ...prefs } as any : s),
        currentSession: state.currentSession?.id === sessionId ? { ...(state.currentSession as any), ...prefs } : state.currentSession,
      }))
    } catch (error: any) {
      set({ error: error.response?.data?.error || error.message || '更新会话偏好失败' })
    }
  },

  sendMessage: async (sessionId: number, content: string) => {
    // 统一走流式发送，保持 API 一致
    await get().streamMessage(sessionId, content)
  },

  streamMessage: async (sessionId: number, content: string, images?: Array<{ data: string; mime: string }>, options?: { reasoningEnabled?: boolean; reasoningEffort?: 'low'|'medium'|'high'; ollamaThink?: boolean; saveReasoning?: boolean }) => {
    // 首先添加用户消息
    // 在发送前尝试基于首条用户输入为“新的对话”自动改名（与常见产品一致）
    try {
      const state = get()
      const cur = state.currentSession
      const isTarget = !!cur && cur.id === sessionId
      const isDefaultTitle = isTarget && (
        !cur!.title || cur!.title.trim() === '' || cur!.title === '新的对话' || cur!.title === 'New Chat'
      )
      const noUserMessagesYet = state.messages.filter(m => m.sessionId === sessionId && m.role === 'user').length === 0

      if (isTarget && isDefaultTitle && noUserMessagesYet) {
        const deriveTitleFrom = (text: string) => {
          if (!text) return ''
          let s = String(text)
          // 去除代码块/图片/多余空白/标题符号
          s = s.replace(/```[\s\S]*?```/g, ' ')
               .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
               .replace(/^[#>\-\*\s]+/gm, '')
               .replace(/\n+/g, ' ')
               .trim()
          // 取前 30 个字符作为标题
          const limit = 30
          return s.length > limit ? s.slice(0, limit) : s
        }

        const newTitle = deriveTitleFrom(content)
        if (newTitle) {
          const prevTitle = cur!.title
          // 本地乐观更新，提升侧边栏即时性
          set((st) => ({
            sessions: st.sessions.map(s => s.id === sessionId ? { ...s, title: newTitle } : s),
            currentSession: st.currentSession?.id === sessionId ? { ...st.currentSession!, title: newTitle } : st.currentSession,
          }))
          // 后台持久化；失败则回滚
          get().updateSessionTitle(sessionId, newTitle).catch(() => {
            set((st) => ({
              sessions: st.sessions.map(s => s.id === sessionId ? { ...s, title: prevTitle } : s),
              currentSession: st.currentSession?.id === sessionId ? { ...st.currentSession!, title: prevTitle } : st.currentSession,
            }))
          })
        }
      }
    } catch (e) {
      // 忽略改名失败，不影响消息发送
    }

    const userMessage: Message = {
      id: Date.now(), // 临时ID
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    if (images && images.length) {
      userMessage.images = images.map(img => `data:${img.mime};base64,${img.data}`)
    }

    // 创建AI消息的占位符
    const aiMessage: Message = {
      id: Date.now() + 1, // 临时ID
      sessionId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }

    set((state) => ({
      messages: [...state.messages, userMessage, aiMessage],
      isStreaming: true,
      error: null,
    }))

    try {
      let accumulatedContent = ''
      let accumulatedReasoning = ''

      for await (const evt of apiClient.streamChat(sessionId, content, images, options)) {
        if (evt?.type === 'content' && evt.content) {
          accumulatedContent += evt.content
          set((state) => ({
            messages: state.messages.map((msg, index) =>
              index === state.messages.length - 1
                ? { ...msg, content: accumulatedContent }
                : msg
            ),
          }))
        } else if (evt?.type === 'reasoning') {
          if (evt.content) {
            accumulatedReasoning += evt.content
            set((state) => ({
              messages: state.messages.map((msg, index) =>
                index === state.messages.length - 1
                  ? { ...msg, reasoning: accumulatedReasoning }
                  : msg
              ),
            }))
          }
          if (evt.done) {
            set((state) => ({
              messages: state.messages.map((msg, index) =>
                index === state.messages.length - 1
                  ? { ...msg, reasoningDurationSeconds: evt.duration }
                  : msg
              ),
            }))
          }
        } else if (evt?.type === 'usage' && evt.usage) {
          // 实时更新当前 usage；若包含 completion/total 则可同步作为 lastRound
          set((state) => ({
            usageCurrent: {
              prompt_tokens: evt.usage.prompt_tokens,
              context_limit: evt.usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
              context_remaining: evt.usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
            },
            usageLastRound: (evt.usage.completion_tokens != null || evt.usage.total_tokens != null) ? evt.usage : state.usageLastRound,
          }))
        }
      }

      set({ isStreaming: false })

      // 重新获取消息列表与 usage 聚合
      await Promise.all([
        get().fetchMessages(sessionId),
        get().fetchUsage(sessionId),
      ])

    } catch (error: any) {
      // 流式失败，降级尝试非流式一次
      try {
        const resp = await apiClient.chatCompletion(sessionId, content, images, options)
        const finalText = resp?.data?.content || ''
        if (finalText) {
          set((state) => ({
            messages: state.messages.map((msg, index) =>
              index === state.messages.length - 1 ? { ...msg, content: finalText } : msg
            ),
            isStreaming: false,
          }))
          // 同步用量（若返回带有 usage 可另行处理，这里触发一次聚合刷新）
          await get().fetchUsage(sessionId)
          return
        }
      } catch (_) {
        // ignore
      }

      set({
        error: error?.response?.data?.error || error?.message || '发送消息失败',
        isStreaming: false,
      })

      // 移除失败的AI消息
      set((state) => ({
        messages: state.messages.filter((msg, index) =>
          !(index === state.messages.length - 1 && msg.role === 'assistant' && msg.content === '')
        ),
      }))
    }
  },

  stopStreaming: () => {
    try { apiClient.cancelStream() } catch {}
    set({ isStreaming: false })
  },

  addMessage: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
    }))
  },

  clearError: () => {
    set({ error: null })
  },
}))
