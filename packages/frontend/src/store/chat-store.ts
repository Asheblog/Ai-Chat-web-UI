import { create } from 'zustand'
import { ChatState, ChatSession, Message } from '@/types'
import { apiClient } from '@/lib/api'
import type { ModelItem } from '@/store/models-store'

interface ChatStore extends ChatState {
  fetchSessions: () => Promise<void>
  fetchSessionsUsage: () => Promise<void>
  fetchMessages: (sessionId: number) => Promise<void>
  fetchUsage: (sessionId: number) => Promise<void>
  createSession: (modelId: string, title?: string, connectionId?: number, rawId?: string) => Promise<void>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  switchSessionModel: (sessionId: number, model: ModelItem) => Promise<void>
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
  messageImageCache: {},
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
      const cache = get().messageImageCache
      const normalized = (response.data || []).map((msg) => {
        if (msg.clientMessageId && cache[msg.clientMessageId]) {
          return { ...msg, images: cache[msg.clientMessageId] }
        }
        return msg
      })
      const nextCache = { ...cache }
      normalized.forEach((msg) => {
        if (msg.clientMessageId && msg.images && msg.images.length > 0) {
          nextCache[msg.clientMessageId] = msg.images
        }
      })
      set({
        messages: normalized,
        messageImageCache: nextCache,
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

  createSession: async (modelId: string, title?: string, connectionId?: number, rawId?: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.createSessionByModelId(modelId, title, connectionId, rawId)
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

  switchSessionModel: async (sessionId: number, model: ModelItem) => {
    try {
      const resp = await apiClient.updateSessionModel(sessionId, {
        modelId: model.id,
        connectionId: model.connectionId,
        rawId: model.rawId || model.id,
      })
      const updated = resp.data
      set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, connectionId: updated.connectionId, modelRawId: updated.modelRawId, modelLabel: updated.modelLabel || model.id } : s),
        currentSession: state.currentSession?.id === sessionId ? { ...(state.currentSession as any), connectionId: updated.connectionId, modelRawId: updated.modelRawId, modelLabel: updated.modelLabel || model.id } : state.currentSession,
      }))
    } catch (error: any) {
      set({ error: error.response?.data?.error || error.message || '切换模型失败' })
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
    const snapshot = get()
    const session = snapshot.sessions.find((s) => s.id === sessionId) || snapshot.currentSession
    if (!session || session.id !== sessionId) {
      set({ error: '会话不存在或未选中' })
      return
    }

    const modelId = session.modelLabel || session.modelRawId || ''

    // 自动改名 - 仅针对首条用户消息
    try {
      const isTarget = snapshot.currentSession?.id === sessionId
      const isDefaultTitle =
        isTarget &&
        (!!snapshot.currentSession?.title === false ||
          snapshot.currentSession?.title === '新的对话' ||
          snapshot.currentSession?.title === 'New Chat')
      const noUserMessagesYet =
        snapshot.messages.filter((m) => m.sessionId === sessionId && m.role === 'user').length === 0

      if (isTarget && isDefaultTitle && noUserMessagesYet && content) {
        const deriveTitle = (text: string) => {
          let s = text
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
            .replace(/^[#>\-\*\s]+/gm, '')
            .replace(/\n+/g, ' ')
            .trim()
          const limit = 30
          return s.length > limit ? s.slice(0, limit) : s
        }
        const titleCandidate = deriveTitle(content)
        if (titleCandidate) {
          const prevTitle = snapshot.currentSession?.title
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === sessionId ? { ...s, title: titleCandidate } : s
            ),
            currentSession:
              state.currentSession?.id === sessionId
                ? { ...state.currentSession, title: titleCandidate }
                : state.currentSession,
          }))
          get()
            .updateSessionTitle(sessionId, titleCandidate)
            .catch(() => {
              set((state) => ({
                sessions: state.sessions.map((s) =>
                  s.id === sessionId ? { ...s, title: prevTitle } : s
                ),
                currentSession:
                  state.currentSession?.id === sessionId
                    ? { ...state.currentSession, title: prevTitle }
                    : state.currentSession,
              }))
            })
        }
      }
    } catch {
      // 忽略改名失败
    }

    const userClientMessageId =
      (() => {
        try {
          return (crypto as any)?.randomUUID?.() ?? ''
        } catch {
          return ''
        }
      })() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`

    const userMessage: Message = {
      id: Date.now(),
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      clientMessageId: userClientMessageId,
      images: images?.length
        ? images.map((img) => `data:${img.mime};base64,${img.data}`)
        : undefined,
    }

    const reasoningPreference =
      snapshot.currentSession?.id === sessionId
        ? snapshot.currentSession?.reasoningEnabled
        : snapshot.sessions.find((s) => s.id === sessionId)?.reasoningEnabled
    const reasoningDesired = Boolean(options?.reasoningEnabled ?? reasoningPreference ?? false)

    const assistantPlaceholder: Message = {
      id: Date.now() + 1,
      sessionId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    }

    set((state) => {
      const nextCache =
        userMessage.clientMessageId && userMessage.images && userMessage.images.length > 0
          ? { ...state.messageImageCache, [userMessage.clientMessageId]: userMessage.images }
          : state.messageImageCache
      return {
        messages: [...state.messages, userMessage, assistantPlaceholder],
        messageImageCache: nextCache,
        isStreaming: true,
        error: null,
      }
    })

    const convertMessageToProvider = (msg: Message): Record<string, any> => {
      const parts: Array<Record<string, any>> = []
      if (msg.content?.trim()) {
        parts.push({ type: 'text', text: msg.content })
      }
      if (msg.images?.length) {
        msg.images.forEach((img) =>
          parts.push({
            type: 'image_url',
            image_url: { url: img },
          })
        )
      }
      if (parts.length === 0) {
        parts.push({ type: 'text', text: '' })
      }
      return {
        role: msg.role,
        content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
      }
    }

    const historyMessages = snapshot.messages
      .filter((m) => m.sessionId === sessionId)
      .map(convertMessageToProvider)
    const providerMessages = [...historyMessages, convertMessageToProvider(userMessage)]

    const streamParams: Record<string, any> = {}
    if (options?.reasoningEffort) streamParams.reasoning_effort = options.reasoningEffort
    if (options?.ollamaThink) streamParams.think = true

    let reasoningActive = false
    let accumulatedContent = ''
    let accumulatedReasoning = ''
    let useV1Pipeline = false

    const updateAssistantMessage = (updater: (msg: Message) => Message) => {
      set((state) => ({
        messages: state.messages.map((msg, index) =>
          index === state.messages.length - 1 ? updater(msg) : msg
        ),
      }))
    }

    const ensureReasoningActivated = () => {
      if (reasoningActive) return
      reasoningActive = true
      accumulatedReasoning = ''
      updateAssistantMessage((msg) => ({
        ...msg,
        reasoningStatus: 'idle',
        reasoningIdleMs: null,
        reasoning: msg.reasoning || '',
      }))
    }

    const startLegacyStream = () =>
      apiClient.streamChat(sessionId, content, images, {
        ...(options || {}),
        clientMessageId: userClientMessageId,
      })

    let iterator: AsyncGenerator<ChatStreamChunk, void, unknown> | null = null

    try {
      if (modelId) {
        try {
          const created = await apiClient.createMessageV1({
            sessionId,
            role: 'user',
            content,
            clientMessageId: userClientMessageId,
          })
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.clientMessageId === userClientMessageId ? { ...msg, id: created.id } : msg
            ),
          }))
          iterator = apiClient.streamV1ChatCompletions({
            modelId,
            messages: providerMessages,
            metadata: { session_id: sessionId },
            params: streamParams,
          })
          useV1Pipeline = true
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[streamMessage] fallback to legacy streaming', err)
          }
          iterator = startLegacyStream()
          useV1Pipeline = false
        }
      } else {
        iterator = startLegacyStream()
        useV1Pipeline = false
      }

      for await (const evt of iterator!) {
        if (evt?.type === 'content' && evt.content) {
          accumulatedContent += evt.content
          set((state) => ({
            messages: state.messages.map((msg, index) =>
              index === state.messages.length - 1 ? { ...msg, content: accumulatedContent } : msg
            ),
          }))
        } else if (evt?.type === 'reasoning') {
          if (!reasoningDesired) continue
          const chunkHasContent = typeof evt.content === 'string' && evt.content.length > 0
          if (!reasoningActive && !chunkHasContent) continue
          ensureReasoningActivated()
          if (evt.keepalive) {
            updateAssistantMessage((msg) => ({
              ...msg,
              reasoningStatus: 'idle',
              reasoningIdleMs: evt.idleMs ?? null,
            }))
            continue
          }
          if (evt.content) {
            accumulatedReasoning += evt.content
            updateAssistantMessage((msg) => ({
              ...msg,
              reasoning: accumulatedReasoning,
              reasoningStatus: 'streaming',
              reasoningIdleMs: null,
            }))
          }
          if (evt.done) {
            updateAssistantMessage((msg) => ({
              ...msg,
              reasoningDurationSeconds: evt.duration ?? msg.reasoningDurationSeconds ?? null,
              reasoningStatus: 'done',
              reasoningIdleMs: null,
            }))
          }
        } else if (evt?.type === 'usage' && evt.usage) {
          const usage = evt.usage
          set((state) => ({
            usageCurrent: {
              prompt_tokens: usage.prompt_tokens,
              context_limit: usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
              context_remaining: usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
            },
            usageLastRound:
              usage.completion_tokens != null || usage.total_tokens != null
                ? usage
                : state.usageLastRound,
          }))
        } else if (evt?.type === 'complete') {
          if (reasoningActive) {
            updateAssistantMessage((msg) => ({
              ...msg,
              reasoningStatus: 'done',
              reasoningIdleMs: null,
            }))
          }
        }
      }

      set((state) => ({
        isStreaming: false,
        messages: reasoningActive
          ? state.messages.map((msg, index) =>
              index === state.messages.length - 1
                ? { ...msg, reasoningStatus: 'done', reasoningIdleMs: null }
                : msg
            )
          : state.messages,
      }))

      if (useV1Pipeline && accumulatedContent.trim()) {
        try {
          const assistantRecord = await apiClient.createMessageV1({
            sessionId,
            role: 'assistant',
            content: accumulatedContent.trim(),
            reasoning: reasoningActive ? accumulatedReasoning.trim() || null : null,
            reasoningDurationSeconds: reasoningActive
              ? get().messages.at(-1)?.reasoningDurationSeconds ?? null
              : null,
          })
          set((state) => ({
            messages: state.messages.map((msg, index) =>
              index === state.messages.length - 1
                ? { ...msg, id: assistantRecord.id }
                : msg
            ),
          }))
          get().fetchMessages(sessionId).catch(() => {})
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.debug('[streamMessage] failed to persist assistant message via v1', err)
          }
        }
      }

      get().fetchUsage(sessionId).catch(() => {})
      get().fetchSessionsUsage().catch(() => {})
    } catch (error: any) {
      try {
        const resp = await apiClient.chatCompletion(sessionId, content, images, {
          ...(options || {}),
          clientMessageId: userClientMessageId,
        })
        const finalText = resp?.data?.content || ''
        if (finalText) {
          set((state) => ({
            messages: state.messages.map((msg, index) =>
              index === state.messages.length - 1
                ? { ...msg, content: finalText, reasoningStatus: 'done', reasoningIdleMs: null }
                : msg
            ),
            isStreaming: false,
          }))
          await get().fetchUsage(sessionId)
          get().fetchSessionsUsage().catch(() => {})
          return
        }
      } catch {
        // ignore secondary failure
      }

      set({
        error: error?.message || '发送消息失败',
        isStreaming: false,
      })
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
    set((state) => {
      const nextCache = message.clientMessageId && message.images && message.images.length > 0
        ? { ...state.messageImageCache, [message.clientMessageId]: message.images }
        : state.messageImageCache
      return {
        messages: [...state.messages, message],
        messageImageCache: nextCache,
      }
    })
  },

  clearError: () => {
    set({ error: null })
  },
}))
