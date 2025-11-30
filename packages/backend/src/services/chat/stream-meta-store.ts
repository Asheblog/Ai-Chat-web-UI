import type { Message } from '../../types'
import { randomUUID } from 'node:crypto'

export type AgentStreamMeta = {
  sessionId: number
  actorId: string
  controller: AbortController | null
  cancelled: boolean
  clientMessageId: string | null
  assistantClientMessageId: string | null
  assistantMessageId: number | string | null
  streamKey: string
}

export type StreamMetaRegistrationParams = {
  sessionId: number
  actorIdentifier: string
  clientMessageId?: string | null
  assistantClientMessageId?: string | null
  assistantMessageId?: number | string | null
  maxActorStreams?: number | null
}

export interface StreamMetaStore {
  buildAgentStreamKey(sessionId: number, clientMessageId?: string | null, messageId?: number | string | null): string
  deriveAssistantClientMessageId(clientMessageId?: string | null): string
  ensureAssistantClientMessageId(value?: string | null): string
  resolveAssistantClientIdFromRequest(value?: string | null): string | null
  registerStreamMeta(params: StreamMetaRegistrationParams): AgentStreamMeta | null
  updateStreamMetaController(meta: AgentStreamMeta | null, controller: AbortController | null): void
  persistStreamMeta(meta: AgentStreamMeta | null): void
  releaseStreamMeta(meta: AgentStreamMeta | null): void
  findStreamMetaByMessageId(sessionId: number, messageId?: number | string | null): AgentStreamMeta | null
  findStreamMetaByClientMessageId(sessionId: number, clientMessageId?: string | null): AgentStreamMeta | null
  findStreamMetaByAssistantClientMessageId(sessionId: number, assistantClientMessageId?: string | null): AgentStreamMeta | null
  getStreamMetaByKey(key: string | null | undefined): AgentStreamMeta | null
  buildPendingCancelKeyByClientId(sessionId: number, clientMessageId?: string | null): string | null
  buildPendingCancelKeyByMessageId(sessionId: number, messageId?: number | string | null): string | null
  registerPendingCancelMarker(params: {
    sessionId: number
    messageId?: number | string | null
    clientMessageId?: string | null
    assistantClientMessageId?: string | null
  }): boolean
  clearPendingCancelMarkers(params: {
    sessionId: number
    messageId?: number | string | null
    clientMessageId?: string | null
    assistantClientMessageId?: string | null
  }): void
  hasPendingStreamCancelKey(key: string | null | undefined): boolean
  deletePendingStreamCancelKey(key: string | null | undefined): void
}

export class MemoryStreamMetaStore implements StreamMetaStore {
  private agentStreamControllers = new Map<string, AgentStreamMeta>()
  private pendingStreamCancels = new Set<string>()
  private activeStreamsByActor = new Map<string, Set<string>>()

  buildAgentStreamKey(sessionId: number, clientMessageId?: string | null, messageId?: number | string | null) {
    if (clientMessageId && clientMessageId.trim()) {
      return `client:${clientMessageId.trim()}`
    }
    if (typeof messageId === 'number' || typeof messageId === 'string') {
      return `session:${sessionId}:${messageId}`
    }
    return `session:${sessionId}`
  }

  deriveAssistantClientMessageId(clientMessageId?: string | null) {
    if (typeof clientMessageId === 'string' && clientMessageId.trim().length > 0) {
      const candidate = `${clientMessageId.trim()}:assistant`
      return candidate.length > 120 ? candidate.slice(0, 120) : candidate
    }
    return `assistant:${randomUUID()}`
  }

  ensureAssistantClientMessageId(value?: string | null): string {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) {
        return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed
      }
    }
    return this.deriveAssistantClientMessageId(null)
  }

  resolveAssistantClientIdFromRequest(value?: string | null) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    if (trimmed.endsWith(':assistant')) {
      return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed
    }
    return this.deriveAssistantClientMessageId(trimmed)
  }

  registerStreamMeta(params: StreamMetaRegistrationParams): AgentStreamMeta | null {
    const { sessionId, actorIdentifier, clientMessageId, assistantClientMessageId, assistantMessageId, maxActorStreams } = params
    const key = this.buildAgentStreamKey(sessionId, clientMessageId ?? null, assistantMessageId ?? null)
    if (!key) return null
    if (typeof maxActorStreams === 'number' && maxActorStreams > 0) {
      const activeCount = this.activeStreamsByActor.get(actorIdentifier)?.size ?? 0
      if (activeCount >= maxActorStreams) {
        return null
      }
    }
    const meta: AgentStreamMeta = {
      sessionId,
      actorId: actorIdentifier,
      controller: null,
      cancelled: false,
      clientMessageId: clientMessageId ?? null,
      assistantClientMessageId: assistantClientMessageId ?? null,
      assistantMessageId: assistantMessageId ?? null,
      streamKey: key,
    }
    this.agentStreamControllers.set(key, meta)
    const actorSet = this.activeStreamsByActor.get(actorIdentifier) ?? new Set<string>()
    actorSet.add(key)
    this.activeStreamsByActor.set(actorIdentifier, actorSet)
    return meta
  }

  updateStreamMetaController(meta: AgentStreamMeta | null, controller: AbortController | null) {
    if (!meta) return
    meta.controller = controller
    this.agentStreamControllers.set(meta.streamKey, meta)
  }

  persistStreamMeta(meta: AgentStreamMeta | null) {
    if (!meta) return
    this.agentStreamControllers.set(meta.streamKey, meta)
  }

  releaseStreamMeta(meta: AgentStreamMeta | null) {
    if (!meta) return
    this.agentStreamControllers.delete(meta.streamKey)
    const actorSet = this.activeStreamsByActor.get(meta.actorId)
    if (actorSet) {
      actorSet.delete(meta.streamKey)
      if (actorSet.size === 0) {
        this.activeStreamsByActor.delete(meta.actorId)
      }
    }
    meta.controller = null
  }

  findStreamMetaByMessageId(sessionId: number, messageId?: number | string | null): AgentStreamMeta | null {
    if (messageId == null) return null
    const target = String(messageId)
    for (const meta of this.agentStreamControllers.values()) {
      if (meta.sessionId === sessionId && meta.assistantMessageId != null && String(meta.assistantMessageId) === target) {
        return meta
      }
    }
    return null
  }

  findStreamMetaByClientMessageId(sessionId: number, clientMessageId?: string | null): AgentStreamMeta | null {
    if (!clientMessageId) return null
    for (const meta of this.agentStreamControllers.values()) {
      if (meta.sessionId === sessionId && meta.clientMessageId === clientMessageId) {
        return meta
      }
    }
    return null
  }

  findStreamMetaByAssistantClientMessageId(sessionId: number, assistantClientMessageId?: string | null): AgentStreamMeta | null {
    if (!assistantClientMessageId) return null
    const target = assistantClientMessageId.trim()
    if (!target) return null
    for (const meta of this.agentStreamControllers.values()) {
      if (meta.sessionId === sessionId && meta.assistantClientMessageId === target) {
        return meta
      }
    }
    return null
  }

  getStreamMetaByKey(key: string | null | undefined): AgentStreamMeta | null {
    if (!key) return null
    return this.agentStreamControllers.get(key) ?? null
  }

  buildPendingCancelKeyByClientId(sessionId: number, clientMessageId?: string | null) {
    if (typeof clientMessageId === 'string') {
      const trimmed = clientMessageId.trim()
      if (trimmed.length > 0) {
        return `session:${sessionId}:client:${trimmed}`
      }
    }
    return null
  }

  buildPendingCancelKeyByMessageId(sessionId: number, messageId?: number | string | null) {
    if (typeof messageId === 'number' || typeof messageId === 'string') {
      return `session:${sessionId}:message:${messageId}`
    }
    return null
  }

  registerPendingCancelMarker(params: {
    sessionId: number
    messageId?: number | string | null
    clientMessageId?: string | null
    assistantClientMessageId?: string | null
  }) {
    const { sessionId, messageId, clientMessageId, assistantClientMessageId } = params
    let registered = false
    const keyByMessage = this.buildPendingCancelKeyByMessageId(sessionId, messageId)
    if (keyByMessage) {
      this.pendingStreamCancels.add(keyByMessage)
      registered = true
    }
    const rawClientKey = this.buildPendingCancelKeyByClientId(sessionId, clientMessageId)
    if (rawClientKey) {
      this.pendingStreamCancels.add(rawClientKey)
      registered = true
    }
    const assistantKey = this.buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId)
    if (assistantKey) {
      this.pendingStreamCancels.add(assistantKey)
      registered = true
    } else if (clientMessageId) {
      const derivedAssistant = this.resolveAssistantClientIdFromRequest(clientMessageId)
      if (derivedAssistant) {
        const derivedKey = this.buildPendingCancelKeyByClientId(sessionId, derivedAssistant)
        if (derivedKey) {
          this.pendingStreamCancels.add(derivedKey)
          registered = true
        }
      }
    }
    return registered
  }

  clearPendingCancelMarkers(params: {
    sessionId: number
    messageId?: number | string | null
    clientMessageId?: string | null
    assistantClientMessageId?: string | null
  }) {
    const { sessionId, messageId, clientMessageId, assistantClientMessageId } = params
    const keys = [
      this.buildPendingCancelKeyByMessageId(sessionId, messageId),
      this.buildPendingCancelKeyByClientId(sessionId, clientMessageId),
      this.buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId),
    ].filter(Boolean) as string[]
    for (const key of keys) {
      this.pendingStreamCancels.delete(key)
    }
  }

  hasPendingStreamCancelKey(key: string | null | undefined) {
    if (!key) return false
    return this.pendingStreamCancels.has(key)
  }

  deletePendingStreamCancelKey(key: string | null | undefined) {
    if (!key) return
    this.pendingStreamCancels.delete(key)
  }
}

export const streamMetaStore = new MemoryStreamMetaStore()
export const STREAMING_PLACEHOLDER_STATUSES: Array<NonNullable<Message['streamStatus']>> = ['pending', 'streaming']
