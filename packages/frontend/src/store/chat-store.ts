import { create } from 'zustand'
import { ChatState, ChatSession, Message } from '@/types'
import { apiClient } from '@/lib/api'

interface ChatStore extends ChatState {
  fetchSessions: () => Promise<void>
  fetchMessages: (sessionId: number) => Promise<void>
  createSession: (modelConfigId: number, title?: string) => Promise<void>
  selectSession: (sessionId: number) => void
  deleteSession: (sessionId: number) => Promise<void>
  updateSessionTitle: (sessionId: number, title: string) => Promise<void>
  sendMessage: (sessionId: number, content: string) => Promise<void>
  streamMessage: (sessionId: number, content: string) => Promise<void>
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

  fetchSessions: async () => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.getSessions()
      set({
        sessions: response.data || [],
        isLoading: false,
      })
    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '获取会话列表失败',
        isLoading: false,
      })
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

  createSession: async (modelConfigId: number, title?: string) => {
    set({ isLoading: true, error: null })
    try {
      const response = await apiClient.createSession(modelConfigId, title)
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
      })
      // 自动加载该会话的消息
      get().fetchMessages(sessionId)
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
      await apiClient.updateSession(sessionId, title)
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

  sendMessage: async (sessionId: number, content: string) => {
    // 统一走流式发送，保持 API 一致
    await get().streamMessage(sessionId, content)
  },

  streamMessage: async (sessionId: number, content: string) => {
    // 首先添加用户消息
    const userMessage: Message = {
      id: Date.now(), // 临时ID
      sessionId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
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

      for await (const chunk of apiClient.streamChat(sessionId, content)) {
        accumulatedContent += chunk

        set((state) => ({
          messages: state.messages.map((msg, index) =>
            index === state.messages.length - 1
              ? { ...msg, content: accumulatedContent }
              : msg
          ),
        }))
      }

      set({ isStreaming: false })

      // 重新获取消息列表以获取真实的消息ID
      get().fetchMessages(sessionId)

    } catch (error: any) {
      set({
        error: error.response?.data?.error || error.message || '发送消息失败',
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
