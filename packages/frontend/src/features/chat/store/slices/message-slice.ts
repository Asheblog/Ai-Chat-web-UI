import { apiClient } from '@/lib/api'
import type { Message } from '@/types'
import type { MessageSlice } from '../types'
import type { ChatSliceCreator, MessageId } from '../types'
import {
  buildRenderCacheEntry,
  buildVariantSelections,
  createBody,
  createMeta,
  findSessionById,
  mergeImages,
  messageKey,
  shouldEnablePythonToolForSession,
  shouldEnableWebSearchForSession,
} from '../utils'

export const createMessageSlice: ChatSliceCreator<
  MessageSlice & {
    messageMetas: import('@/types').MessageMeta[]
    messageBodies: Record<string, import('@/types').MessageBody>
    messageRenderCache: Record<string, import('@/types').MessageRenderCacheEntry>
    messageImageCache: Record<string, string[]>
    messagesHydrated: Record<number, boolean>
    isMessagesLoading: boolean
    toolEvents: import('@/types').ToolEvent[]
    assistantVariantSelections: Record<string, MessageId>
  }
> = (set, get, runtime) => ({
  messageMetas: [],
  messageBodies: {},
  messageRenderCache: {},
  messageImageCache: {},
  messagesHydrated: {},
  isMessagesLoading: false,
  toolEvents: [],
  assistantVariantSelections: {},

  fetchMessages: async (sessionId: number) => {
    set({ isMessagesLoading: true, error: null })
    try {
      const response = await apiClient.getMessages(sessionId)
      const cache = get().messageImageCache
      const rawMessages = Array.isArray(response.data) ? response.data : []
      const normalized = rawMessages.map((msg) => mergeImages(msg, cache))

      const nextCache = { ...cache }
      normalized.forEach((msg) => {
        if (msg.clientMessageId && msg.images && msg.images.length > 0) {
          nextCache[msg.clientMessageId] = msg.images
        }
      })

      set((state) => {
        const existingSessionMetas = state.messageMetas.filter((meta) => meta.sessionId === sessionId)
        const metaByStableKey = new Map(existingSessionMetas.map((meta) => [meta.stableKey, meta]))
        const bodyEntryByStableKey = new Map<string, { key: string; body: import('@/types').MessageBody }>()
        const sessionBodyKeys = new Set<string>()
        existingSessionMetas.forEach((meta) => {
          const key = messageKey(meta.id)
          sessionBodyKeys.add(key)
          const body = state.messageBodies[key]
          if (body) {
            bodyEntryByStableKey.set(meta.stableKey, { key, body })
          }
        })

        const nextSessionMetas: import('@/types').MessageMeta[] = []
        const nextSessionBodyEntries: Array<[string, import('@/types').MessageBody]> = []

        normalized.forEach((msg) => {
          const serverMeta = createMeta(msg)
          const stableKey = serverMeta.stableKey
          const existing = metaByStableKey.get(stableKey)
          const mergedMeta = existing
            ? {
                ...existing,
                ...serverMeta,
                isPlaceholder: false,
                pendingSync: false,
              }
            : serverMeta
          nextSessionMetas.push(mergedMeta)
          metaByStableKey.delete(stableKey)

          const body = createBody(msg, stableKey)
          const existingBodyEntry = bodyEntryByStableKey.get(stableKey)
          if (existingBodyEntry) {
            const prevBody = existingBodyEntry.body
            if ((body.reasoning == null || body.reasoning.length === 0) && prevBody.reasoning) {
              body.reasoning = prevBody.reasoning
              body.reasoningVersion = prevBody.reasoningVersion
            }
            if ((!body.toolEvents || body.toolEvents.length === 0) && prevBody.toolEvents?.length) {
              body.toolEvents = prevBody.toolEvents
            }
          }
          nextSessionBodyEntries.push([messageKey(body.id), body])
        })

        metaByStableKey.forEach((meta) => {
          nextSessionMetas.push(meta)
          const existingBodyKey = Array.from(sessionBodyKeys).find(
            (key) => state.messageBodies[key]?.stableKey === meta.stableKey,
          )
          if (existingBodyKey) {
            nextSessionBodyEntries.push([existingBodyKey, state.messageBodies[existingBodyKey]])
            sessionBodyKeys.delete(existingBodyKey)
          }
        })

        nextSessionMetas.sort((a, b) => {
          const aTime = new Date(a.createdAt).getTime()
          const bTime = new Date(b.createdAt).getTime()
          if (aTime !== bTime) return aTime - bTime
          return messageKey(a.id).localeCompare(messageKey(b.id))
        })

        const otherMetas = state.messageMetas.filter((meta) => meta.sessionId !== sessionId)
        const nextMetas = [...otherMetas, ...nextSessionMetas]

        const nextBodies = { ...state.messageBodies }
        sessionBodyKeys.forEach((key) => {
          delete nextBodies[key]
        })
        nextSessionBodyEntries.forEach(([key, body]) => {
          nextBodies[key] = body
        })

        const nextRenderCache = { ...state.messageRenderCache }
        Array.from(sessionBodyKeys).forEach((key) => {
          delete nextRenderCache[key]
        })

        return {
          messageMetas: nextMetas,
          assistantVariantSelections: buildVariantSelections(nextMetas),
          messageBodies: nextBodies,
          messageRenderCache: nextRenderCache,
          messageImageCache: nextCache,
          messagesHydrated: { ...state.messagesHydrated, [sessionId]: true },
          isMessagesLoading: false,
          toolEvents: state.toolEvents.filter((event) => event.sessionId !== sessionId),
        }
      })
      normalized.forEach((msg) => {
        if (
          msg.role === 'assistant' &&
          msg.streamStatus === 'streaming' &&
          typeof msg.id === 'number'
        ) {
          runtime.startMessageProgressWatcher(sessionId, Number(msg.id))
        }
      })
      if (normalized.some((msg) => msg.streamStatus === 'streaming')) {
        set((state) => ({
          isStreaming: state.currentSession?.id === sessionId,
          activeStreamSessionId: sessionId,
        }))
      } else {
        set((state) =>
          state.activeStreamSessionId === sessionId
            ? { activeStreamSessionId: null, isStreaming: state.currentSession?.id === sessionId ? false : state.isStreaming }
            : state,
        )
        runtime.recomputeStreamingState()
      }
      runtime.applyBufferedSnapshots(sessionId)
    } catch (error: any) {
      set({
        error: error?.response?.data?.error || error?.message || '获取消息列表失败',
        isMessagesLoading: false,
      })
    }
  },

  addMessage: (message: Message) => {
    set((state) => {
      const key = messageKey(message.id)
      const nextCache =
        message.clientMessageId && message.images && message.images.length > 0
          ? { ...state.messageImageCache, [message.clientMessageId]: message.images }
          : state.messageImageCache
      const renderCache = { ...state.messageRenderCache }
      delete renderCache[key]
      return {
        messageMetas: [...state.messageMetas, createMeta(message)],
        messageBodies: { ...state.messageBodies, [key]: createBody(message) },
        messageImageCache: nextCache,
        messageRenderCache: renderCache,
      }
    })
  },

  applyRenderedContent: (messageId, payload) => {
    const key = messageKey(messageId)
    set((state) => {
      const body = state.messageBodies[key]
      if (!body) return state

      const {
        contentHtml = null,
        reasoningHtml = null,
        contentVersion = body.version,
        reasoningVersion = body.reasoningVersion,
      } = payload

      if (
        (contentVersion != null && contentVersion < body.version) ||
        (reasoningVersion != null && reasoningVersion < body.reasoningVersion)
      ) {
        return state
      }

      const entry = buildRenderCacheEntry(body, {
        contentHtml,
        reasoningHtml,
        contentVersion,
        reasoningVersion,
      })

      return {
        messageRenderCache: {
          ...state.messageRenderCache,
          [key]: entry,
        },
      }
    })
  },

  invalidateRenderedContent: (messageId) => {
    if (typeof messageId === 'undefined') {
      set({ messageRenderCache: {} })
      return
    }
    const key = messageKey(messageId)
    set((state) => {
      if (!state.messageRenderCache[key]) return state
      const next = { ...state.messageRenderCache }
      delete next[key]
      return { messageRenderCache: next }
    })
  },

  regenerateAssistantMessage: async (messageId: MessageId) => {
    const snapshot = get()
    if (snapshot.isStreaming) {
      set({ error: '正在生成新的回答，请稍后重试' })
      return
    }
    const meta = snapshot.messageMetas.find(
      (item) => messageKey(item.id) === messageKey(messageId),
    )
    if (!meta || meta.role !== 'assistant' || meta.parentMessageId == null) {
      set({ error: '无法重新生成该回答' })
      return
    }
    const parentKey = messageKey(meta.parentMessageId)
    const parentMeta =
      snapshot.messageMetas.find(
        (item) =>
          item.sessionId === meta.sessionId &&
          item.role === 'user' &&
          messageKey(item.id) === parentKey,
      ) ?? null
    const targetSession = findSessionById(snapshot.sessions, snapshot.currentSession, meta.sessionId)
    const shouldRequestWebSearch = shouldEnableWebSearchForSession(targetSession)
    const shouldRequestPythonTool = shouldEnablePythonToolForSession(targetSession)
    const featureFlags: Record<string, any> = {}
    if (shouldRequestWebSearch) {
      featureFlags.web_search = true
    }
    if (shouldRequestPythonTool) {
      featureFlags.python_tool = true
    }
    await snapshot.streamMessage(meta.sessionId, '', undefined, {
      replyToMessageId: typeof meta.parentMessageId === 'number' ? meta.parentMessageId : undefined,
      replyToClientMessageId:
        parentMeta?.clientMessageId ??
        (typeof meta.parentMessageId === 'string' ? meta.parentMessageId : undefined),
      features: Object.keys(featureFlags).length > 0 ? featureFlags : undefined,
    })
  },

  cycleAssistantVariant: (parentKey: string, direction: 'prev' | 'next') => {
    set((state) => {
      if (!parentKey) return state
      const variants = state.messageMetas
        .filter(
          (meta) =>
            meta.role === 'assistant' &&
            meta.parentMessageId != null &&
            messageKey(meta.parentMessageId) === parentKey,
        )
        .sort((a, b) => {
          const aIndex = typeof a.variantIndex === 'number' ? a.variantIndex : null
          const bIndex = typeof b.variantIndex === 'number' ? b.variantIndex : null
          if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
            return aIndex - bIndex
          }
          const aTime = new Date(a.createdAt).getTime()
          const bTime = new Date(b.createdAt).getTime()
          if (aTime !== bTime) return aTime - bTime
          return messageKey(a.id).localeCompare(messageKey(b.id))
        })
      if (variants.length <= 1) {
        return state
      }
      const currentSelection = state.assistantVariantSelections[parentKey]
      let idx = variants.findIndex(
        (meta) => messageKey(meta.id) === messageKey(currentSelection ?? variants[variants.length - 1].id),
      )
      if (idx === -1) {
        idx = variants.length - 1
      }
      const delta = direction === 'next' ? 1 : -1
      const nextIndex = (idx + delta + variants.length) % variants.length
      const nextVariant = variants[nextIndex]
      return {
        assistantVariantSelections: {
          ...state.assistantVariantSelections,
          [parentKey]: nextVariant.id,
        },
      }
    })
  },
})
