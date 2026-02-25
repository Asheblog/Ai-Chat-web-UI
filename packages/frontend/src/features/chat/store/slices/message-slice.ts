import { getMessages, getSessionArtifacts, updateUserMessage } from '@/features/chat/api'
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

// 用于取消消息加载请求的 AbortController
let messagesAbortController: AbortController | null = null
const DEFAULT_MESSAGE_PAGE_LIMIT = 50

export const createMessageSlice: ChatSliceCreator<
  MessageSlice & {
    messageMetas: import('@/types').MessageMeta[]
    messageBodies: Record<string, import('@/types').MessageBody>
    messageRenderCache: Record<string, import('@/types').MessageRenderCacheEntry>
    messageMetrics: Record<string, import('@/types').MessageStreamMetrics>
    messageImageCache: Record<string, string[]>
    messagesHydrated: Record<number, boolean>
    messagePaginationBySession: Record<
      number,
      {
        oldestLoadedPage: number
        newestLoadedPage: number
        totalPages: number
        limit: number
        hasOlder: boolean
        isLoadingOlder: boolean
      }
    >
    isMessagesLoading: boolean
    toolEvents: import('@/types').ToolEvent[]
    assistantVariantSelections: Record<string, MessageId>
  }
> = (set, get, runtime) => ({
  messageMetas: [],
  messageBodies: {},
  messageRenderCache: {},
  messageMetrics: {},
  messageImageCache: {},
  messagesHydrated: {},
  messagePaginationBySession: {},
  isMessagesLoading: false,
  toolEvents: [],
  assistantVariantSelections: {},

  fetchMessages: async (sessionId: number, options) => {
    const mode = options?.mode ?? 'replace'
    const isPrependMode = mode === 'prepend'
    const requestedPage = options?.page ?? 'latest'
    let effectivePage: number | 'latest' = requestedPage
    const limit = Number.isFinite(options?.limit) ? Number(options?.limit) : DEFAULT_MESSAGE_PAGE_LIMIT

    if (isPrependMode) {
      const paging = get().messagePaginationBySession[sessionId]
      if (!paging || paging.isLoadingOlder || !paging.hasOlder) return
      const nextPage = typeof requestedPage === 'number' ? requestedPage : paging.oldestLoadedPage - 1
      if (!Number.isFinite(nextPage) || nextPage < 1) {
        set((state) => ({
          messagePaginationBySession: {
            ...state.messagePaginationBySession,
            [sessionId]: {
              ...paging,
              hasOlder: false,
              isLoadingOlder: false,
            },
          },
        }))
        return
      }
      effectivePage = nextPage
    }

    // 取消之前的消息加载请求
    if (messagesAbortController) {
      messagesAbortController.abort()
    }
    messagesAbortController = new AbortController()
    const currentController = messagesAbortController

    set((state) => ({
      isMessagesLoading: isPrependMode ? state.isMessagesLoading : true,
      error: null,
      messagePaginationBySession: {
        ...state.messagePaginationBySession,
        ...(isPrependMode
          ? {
              [sessionId]: {
                ...(state.messagePaginationBySession[sessionId] || {
                  oldestLoadedPage: 1,
                  newestLoadedPage: 1,
                  totalPages: 1,
                  limit,
                  hasOlder: false,
                }),
                isLoadingOlder: true,
              },
            }
          : {}),
      },
    }))
    try {
      const response = await getMessages(sessionId, currentController.signal, {
        page: effectivePage,
        limit,
      })

      // 如果请求被取消，直接返回
      if (currentController.signal.aborted) {
        return
      }

      const cache = get().messageImageCache
      const rawMessages = Array.isArray(response.data) ? response.data : []
      const artifactGroups = new Map<number, import('@/types').WorkspaceArtifact[]>()
      try {
        const artifacts = await getSessionArtifacts(sessionId)
        for (const artifact of artifacts) {
          const messageId = typeof artifact.messageId === 'number' ? artifact.messageId : null
          if (!messageId) continue
          const list = artifactGroups.get(messageId) ?? []
          list.push(artifact)
          artifactGroups.set(messageId, list)
        }
      } catch {
        // ignore artifact restore failures to avoid blocking message loading
      }

      const normalized = rawMessages.map((msg) => {
        const merged = mergeImages(msg, cache)
        const messageId = typeof merged.id === 'number' ? merged.id : null
        if (!messageId) return merged
        const artifacts = artifactGroups.get(messageId)
        if (!artifacts || artifacts.length === 0) return merged
        return {
          ...merged,
          artifacts,
        }
      })

      const nextCache = { ...cache }
      normalized.forEach((msg) => {
        if (msg.clientMessageId && msg.images && msg.images.length > 0) {
          nextCache[msg.clientMessageId] = msg.images
        }
      })

      const pagination = response.pagination
      const resolvedPageRaw =
        typeof pagination?.page === 'number'
          ? pagination.page
          : typeof effectivePage === 'number'
            ? effectivePage
            : 1
      const resolvedPage = Math.max(1, Math.floor(resolvedPageRaw))
      const totalPagesRaw = typeof pagination?.totalPages === 'number' ? pagination.totalPages : resolvedPage
      const totalPages = Math.max(1, Math.floor(totalPagesRaw))
      const resolvedLimitRaw = typeof pagination?.limit === 'number' ? pagination.limit : limit
      const resolvedLimit = Math.max(1, Math.floor(resolvedLimitRaw))

      set((state) => {
        // 二次验证：如果当前会话已经切换，丢弃过期数据
        if (state.currentSession?.id !== sessionId) {
          const existingPaging = state.messagePaginationBySession[sessionId]
          return {
            isMessagesLoading: false,
            messagePaginationBySession: {
              ...state.messagePaginationBySession,
              ...(existingPaging
                ? {
                    [sessionId]: {
                      ...existingPaging,
                      isLoadingOlder: false,
                    },
                  }
                : {}),
            },
          }
        }

        const existingSessionMetas = state.messageMetas.filter((meta) => meta.sessionId === sessionId)
        const metaByStableKey = new Map(existingSessionMetas.map((meta) => [meta.stableKey, meta]))
        const bodyEntryByStableKey = new Map<string, { key: string; body: import('@/types').MessageBody }>()
        const sessionBodyKeys = new Set<string>()
        const prevSessionKeys = existingSessionMetas.map((meta) => messageKey(meta.id))
        const sessionMetricsEntries: Array<[string, import('@/types').MessageStreamMetrics]> = []
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
          if (msg.role === 'assistant' && msg.metrics) {
            sessionMetricsEntries.push([messageKey(body.id), msg.metrics])
          }
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
        const nextMetrics = { ...(state.messageMetrics || {}) }
        prevSessionKeys.forEach((key) => {
          delete nextMetrics[key]
        })
        sessionMetricsEntries.forEach(([key, metrics]) => {
          nextMetrics[key] = metrics
        })

        const previousPaging = state.messagePaginationBySession[sessionId]
        const oldestLoadedPage =
          previousPaging && isPrependMode
            ? Math.min(previousPaging.oldestLoadedPage, resolvedPage)
            : resolvedPage
        const newestLoadedPage =
          previousPaging && isPrependMode
            ? Math.max(previousPaging.newestLoadedPage, resolvedPage)
            : resolvedPage
        const hasOlder = oldestLoadedPage > 1
        const nextPaging = {
          oldestLoadedPage,
          newestLoadedPage,
          totalPages,
          limit: resolvedLimit,
          hasOlder,
          isLoadingOlder: false,
        }

        return {
          messageMetas: nextMetas,
          assistantVariantSelections: buildVariantSelections(nextMetas),
          messageBodies: nextBodies,
          messageRenderCache: nextRenderCache,
          messageMetrics: nextMetrics,
          messageImageCache: nextCache,
          messagesHydrated: { ...state.messagesHydrated, [sessionId]: true },
          isMessagesLoading: false,
          messagePaginationBySession: {
            ...state.messagePaginationBySession,
            [sessionId]: nextPaging,
          },
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
      // 如果是请求被取消，静默处理，不显示错误
      if (error?.name === 'AbortError' || error?.name === 'CanceledError' || currentController.signal.aborted) {
        set((state) => ({
          isMessagesLoading: false,
          messagePaginationBySession: {
            ...state.messagePaginationBySession,
            ...(state.messagePaginationBySession[sessionId]
              ? {
                  [sessionId]: {
                    ...state.messagePaginationBySession[sessionId],
                    isLoadingOlder: false,
                  },
                }
              : {}),
          },
        }))
        return
      }
      set((state) => ({
        error: error?.response?.data?.error || error?.message || '获取消息列表失败',
        isMessagesLoading: false,
        messagePaginationBySession: {
          ...state.messagePaginationBySession,
          ...(state.messagePaginationBySession[sessionId]
            ? {
                [sessionId]: {
                  ...state.messagePaginationBySession[sessionId],
                  isLoadingOlder: false,
                },
              }
            : {}),
        },
      }))
    }
  },

  loadOlderMessages: async (sessionId: number) => {
    const paging = get().messagePaginationBySession[sessionId]
    if (!paging || paging.isLoadingOlder || !paging.hasOlder) return
    const targetPage = paging.oldestLoadedPage - 1
    if (!Number.isFinite(targetPage) || targetPage < 1) {
      set((state) => ({
        messagePaginationBySession: {
          ...state.messagePaginationBySession,
          [sessionId]: {
            ...paging,
            hasOlder: false,
            isLoadingOlder: false,
          },
        },
      }))
      return
    }
    await get().fetchMessages(sessionId, {
      mode: 'prepend',
      page: targetPage,
      limit: paging.limit || DEFAULT_MESSAGE_PAGE_LIMIT,
    })
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

  editLastUserMessage: async (sessionId, messageId, content) => {
    const snapshot = get()
    if (snapshot.isStreaming) {
      set({ error: '正在生成新的回答，请稍后再编辑' })
      return false
    }
    if (typeof sessionId !== 'number' || !Number.isFinite(sessionId)) {
      set({ error: '会话ID无效' })
      return false
    }
    if (typeof messageId !== 'number') {
      set({ error: '仅支持编辑已落库的用户消息' })
      return false
    }

    const nextContent = typeof content === 'string' ? content.trim() : ''
    if (!nextContent) {
      set({ error: '内容不能为空' })
      return false
    }

    const meta =
      snapshot.messageMetas.find(
        (item) =>
          item.sessionId === sessionId &&
          item.role === 'user' &&
          messageKey(item.id) === messageKey(messageId),
      ) ?? null
    if (!meta) {
      set({ error: '未找到要编辑的用户消息' })
      return false
    }

    const lastUserMeta =
      snapshot.messageMetas
        .filter((item) => item.sessionId === sessionId && item.role === 'user')
        .sort((a, b) => {
          const aTime = new Date(a.createdAt).getTime()
          const bTime = new Date(b.createdAt).getTime()
          if (aTime !== bTime) return aTime - bTime
          return messageKey(a.id).localeCompare(messageKey(b.id))
        })
        .at(-1) ?? null
    if (!lastUserMeta || messageKey(lastUserMeta.id) !== messageKey(meta.id)) {
      set({ error: '仅支持编辑当前会话的上一条提问（不跨消息）' })
      return false
    }

    try {
      const result = await updateUserMessage(sessionId, messageId, nextContent)
      if (!result?.success) {
        set({ error: (result as any)?.error || '编辑消息失败' })
        return false
      }
    } catch (error: any) {
      set({ error: error?.response?.data?.error || error?.message || '编辑消息失败' })
      return false
    }

    set((state) => {
      const targetKey = messageKey(messageId)
      const prevBody = state.messageBodies[targetKey]
      const nextBodies = { ...state.messageBodies }
      nextBodies[targetKey] = {
        ...(prevBody ?? { id: messageId, stableKey: meta.stableKey, content: '', reasoning: '', version: 0, reasoningVersion: 0 }),
        content: nextContent,
        version: (prevBody?.version ?? 0) + 1,
      }

      const deleteKeys: string[] = []
      const nextMetas = state.messageMetas.filter((item) => {
        if (item.sessionId !== sessionId) return true
        if (item.role !== 'assistant') return true
        if (item.parentMessageId == null) return true
        const match = messageKey(item.parentMessageId) === targetKey
        if (match) {
          deleteKeys.push(messageKey(item.id))
        }
        return !match
      })

      const nextRenderCache = { ...state.messageRenderCache }
      delete nextRenderCache[targetKey]
      deleteKeys.forEach((key) => {
        delete nextBodies[key]
        delete nextRenderCache[key]
      })

      const nextMetrics = { ...(state.messageMetrics || {}) }
      deleteKeys.forEach((key) => {
        delete nextMetrics[key]
      })

      return {
        messageMetas: nextMetas,
        assistantVariantSelections: buildVariantSelections(nextMetas),
        messageBodies: nextBodies,
        messageRenderCache: nextRenderCache,
        messageMetrics: nextMetrics,
        toolEvents: state.toolEvents.filter(
          (event) => event.sessionId !== sessionId || !deleteKeys.includes(messageKey(event.messageId)),
        ),
        error: null,
      }
    })

    const targetSession = findSessionById(snapshot.sessions, snapshot.currentSession, sessionId)
    const shouldRequestWebSearch = shouldEnableWebSearchForSession(targetSession)
    const shouldRequestPythonTool = shouldEnablePythonToolForSession(targetSession)
    const enabledSkills: string[] = []
    if (shouldRequestWebSearch) {
      enabledSkills.push('web-search', 'url-reader')
    }
    if (shouldRequestPythonTool) {
      enabledSkills.push('python-runner')
    }

    await get().streamMessage(sessionId, '', undefined, {
      replyToMessageId: messageId,
      replyToClientMessageId: meta.clientMessageId ?? undefined,
      skills:
        enabledSkills.length > 0
          ? { enabled: Array.from(new Set(enabledSkills)) }
          : undefined,
    })

    return true
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
    const enabledSkills: string[] = []
    if (shouldRequestWebSearch) {
      enabledSkills.push('web-search', 'url-reader')
    }
    if (shouldRequestPythonTool) {
      enabledSkills.push('python-runner')
    }
    await snapshot.streamMessage(meta.sessionId, '', undefined, {
      replyToMessageId: typeof meta.parentMessageId === 'number' ? meta.parentMessageId : undefined,
      replyToClientMessageId:
        parentMeta?.clientMessageId ??
        (typeof meta.parentMessageId === 'string' ? meta.parentMessageId : undefined),
      skills:
        enabledSkills.length > 0
          ? { enabled: Array.from(new Set(enabledSkills)) }
          : undefined,
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
