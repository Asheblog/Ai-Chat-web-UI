import { buildVariantSelections, messageKey } from '../utils'
import type { StreamEventContext } from './stream-event-context'

export const handleStartEvent = (evt: any, ctx: StreamEventContext): void => {
  const { active, assistantPlaceholder, userMessageId, sessionId, set } = ctx

  const normalizedAssistantClientId =
    typeof evt.assistantClientMessageId === 'string' && evt.assistantClientMessageId.trim()
      ? evt.assistantClientMessageId.trim()
      : null
  if (
    typeof evt.messageId === 'number' &&
    Number.isFinite(evt.messageId) &&
    active.clientMessageId
  ) {
    const realUserId = Number(evt.messageId)
    const clientId = active.clientMessageId
    const placeholderUserId =
      typeof userMessageId === 'number' && Number.isFinite(userMessageId)
        ? userMessageId
        : null

    set((state) => {
      const userMetaIdx = state.messageMetas.findIndex(
        (meta) =>
          meta.sessionId === sessionId &&
          meta.role === 'user' &&
          meta.clientMessageId === clientId &&
          meta.id !== realUserId,
      )
      if (userMetaIdx === -1) return state

      const prevMeta = state.messageMetas[userMetaIdx]
      const prevKey = messageKey(prevMeta.id)
      const nextKey = messageKey(realUserId)

      const nextMetas = state.messageMetas.slice()
      nextMetas[userMetaIdx] = {
        ...prevMeta,
        id: realUserId,
      }

      for (let i = 0; i < nextMetas.length; i += 1) {
        const meta = nextMetas[i]
        if (
          meta.role === 'assistant' &&
          meta.parentMessageId != null &&
          messageKey(meta.parentMessageId) === prevKey
        ) {
          nextMetas[i] = { ...meta, parentMessageId: realUserId }
        }
      }

      const nextBodies = { ...state.messageBodies }
      const prevBody = nextBodies[prevKey]
      if (prevBody) {
        nextBodies[nextKey] = { ...prevBody, id: realUserId }
        delete nextBodies[prevKey]
      }

      const nextRenderCache = { ...state.messageRenderCache }
      if (nextRenderCache[prevKey]) {
        nextRenderCache[nextKey] = nextRenderCache[prevKey]
        delete nextRenderCache[prevKey]
      }

      return {
        messageMetas: nextMetas,
        assistantVariantSelections: buildVariantSelections(nextMetas),
        messageBodies: nextBodies,
        messageRenderCache: nextRenderCache,
      }
    })

    if (assistantPlaceholder.parentMessageId === placeholderUserId) {
      assistantPlaceholder.parentMessageId = realUserId
    }
  }

  if (typeof evt.assistantMessageId === 'number') {
    const nextId = evt.assistantMessageId
    if (messageKey(active.assistantId) !== messageKey(nextId)) {
      const prevKey = messageKey(active.assistantId)
      const nextKey = messageKey(nextId)
      const nextStableKey = normalizedAssistantClientId ? `client:${normalizedAssistantClientId}` : null
      set((state) => {
        const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === prevKey)
        const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
        if (metaIndex !== -1) {
          nextMetas[metaIndex] = {
            ...nextMetas[metaIndex],
            id: nextId,
            clientMessageId: normalizedAssistantClientId ?? nextMetas[metaIndex].clientMessageId,
            stableKey: nextStableKey ?? nextMetas[metaIndex].stableKey,
            streamStatus: 'streaming',
            isPlaceholder: false,
          }
        }
        const prevBody = state.messageBodies[prevKey]
        const nextBodies = { ...state.messageBodies }
        if (prevBody) {
          delete nextBodies[prevKey]
          nextBodies[nextKey] = {
            ...prevBody,
            id: nextId,
            stableKey: nextStableKey ?? prevBody.stableKey,
          }
        }
        const nextRenderCache = { ...state.messageRenderCache }
        if (nextRenderCache[prevKey]) {
          nextRenderCache[nextKey] = nextRenderCache[prevKey]
          delete nextRenderCache[prevKey]
        }
        const nextToolEvents =
          state.toolEvents.length > 0
            ? state.toolEvents.map((event) =>
                messageKey(event.messageId) === prevKey
                  ? { ...event, messageId: nextId }
                  : event,
              )
            : state.toolEvents
        const partial: Partial<import('@/types').ChatState> = {}
        if (metaIndex !== -1) partial.messageMetas = nextMetas
        if (metaIndex !== -1) {
          partial.assistantVariantSelections = buildVariantSelections(nextMetas)
        }
        if (prevBody) partial.messageBodies = nextBodies
        if (nextRenderCache[nextKey]) partial.messageRenderCache = nextRenderCache
        if (nextToolEvents !== state.toolEvents) {
          partial.toolEvents = nextToolEvents
        }
        return Object.keys(partial).length > 0 ? partial : state
      })
      active.assistantId = nextId
      assistantPlaceholder.id = nextId
    }
  }
  if (normalizedAssistantClientId) {
    active.assistantClientMessageId = normalizedAssistantClientId
    const assistantKey = messageKey(active.assistantId)
    const nextStableKey = `client:${normalizedAssistantClientId}`
    set((state) => {
      const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === assistantKey)
      const body = state.messageBodies[assistantKey]
      if (metaIndex === -1 && !body) return state

      const partial: Partial<import('@/types').ChatState> = {}
      if (metaIndex !== -1) {
        const prevMeta = state.messageMetas[metaIndex]
        if (prevMeta.clientMessageId !== normalizedAssistantClientId || prevMeta.stableKey !== nextStableKey) {
          const nextMetas = state.messageMetas.slice()
          nextMetas[metaIndex] = {
            ...prevMeta,
            clientMessageId: normalizedAssistantClientId,
            stableKey: nextStableKey,
          }
          partial.messageMetas = nextMetas
          partial.assistantVariantSelections = buildVariantSelections(nextMetas)
        }
      }
      if (body && body.stableKey !== nextStableKey) {
        partial.messageBodies = {
          ...state.messageBodies,
          [assistantKey]: {
            ...body,
            stableKey: nextStableKey,
          },
        }
      }
      return Object.keys(partial).length > 0 ? partial : state
    })
  }
}
