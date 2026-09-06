import { shouldIgnoreReasoningMeta } from '@aichat/shared/strip-tool-progress-from-reasoning'
import { upsertToolEventFromChunk } from '@aichat/shared/stream-message-reducer'
import { useAuthStore } from '@/store/auth-store'
import {
  messageKey,
  resolveProviderSafetyMessage,
} from '../utils'
import { handleCompleteEvent } from './stream-complete-event'
import type { StreamEventContext } from './stream-event-context'
import { handleStartEvent } from './stream-start-event'

export type { StreamEventContext } from './stream-event-context'

export const handleStreamEvent = (evt: any, ctx: StreamEventContext): void => {
  const { active, sessionId, set, get, runtime } = ctx

  if (evt?.type === 'start') {
    handleStartEvent(evt, ctx)
    return
  }

  if (evt?.type === 'tool_call') {
    set((state) => {
      const reasoningLengthAtEvent = Math.max(
        0,
        (active.reasoning?.length ?? 0) + (active.pendingReasoning?.length ?? 0),
      )
      const toolEvents = upsertToolEventFromChunk(state.toolEvents, evt, {
        sessionId,
        messageId: active.assistantId,
        reasoningLength: reasoningLengthAtEvent,
      })
      const latest = toolEvents[toolEvents.length - 1]
      runtime.snapshotDebug('tool:add', {
        sessionId,
        messageId: latest?.messageId,
        stage: latest?.stage,
        total: toolEvents.length,
      })
      return { toolEvents }
    })
    runtime.persistSnapshotForStream(active)
    return
  }

  if (evt?.type === 'skill_approval_request' || evt?.type === 'skill_approval_result') {
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('aichat:skill-approval', {
            detail: evt,
          }),
        )
      } catch {
        // ignore UI dispatch errors
      }
    }
    return
  }

  if (evt?.type === 'compression_applied') {
    get().fetchMessages(sessionId, { page: 'latest', mode: 'replace' }).catch(() => {})
    return
  }

  if (evt?.type === 'error') {
    const fallback =
      typeof evt.error === 'string' && evt.error.trim()
        ? evt.error
        : '工具调用失败，请稍后重试'
    const friendlyMessage = resolveProviderSafetyMessage(evt.error) ?? fallback
    const agentError = new Error(friendlyMessage)
    ;(agentError as any).handled = 'agent_error'
    runtime.updateMetaStreamStatus(active.assistantId, 'error', friendlyMessage)
    throw agentError
  }

  // 处理生图模型返回的图片
  if (evt?.type === 'image' && evt.generatedImages) {
    set((state) => {
      const assistantKey = messageKey(active.assistantId)
      // 更新 messageMeta
      const metaIndex = state.messageMetas.findIndex(
        (meta) => messageKey(meta.id) === assistantKey,
      )
      const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
      if (metaIndex !== -1) {
        nextMetas[metaIndex] = {
          ...nextMetas[metaIndex],
          generatedImages: evt.generatedImages,
        }
      }
      // 更新 messageBody
      const prevBody = state.messageBodies[assistantKey]
      const nextBodies = prevBody
        ? {
            ...state.messageBodies,
            [assistantKey]: {
              ...prevBody,
              generatedImages: evt.generatedImages,
            },
          }
        : state.messageBodies

      return {
        messageMetas: nextMetas,
        messageBodies: nextBodies,
      }
    })
    return
  }

  if (evt?.type === 'artifact' && Array.isArray(evt.artifacts) && evt.artifacts.length > 0) {
    set((state) => {
      const assistantKey = messageKey(active.assistantId)
      const mergeArtifacts = (
        previous: import('@/types').WorkspaceArtifact[] | undefined,
        incoming: import('@/types').WorkspaceArtifact[],
      ) => {
        const merged = new Map<number, import('@/types').WorkspaceArtifact>()
        for (const item of previous || []) {
          if (typeof item?.id === 'number') {
            merged.set(item.id, item)
          }
        }
        for (const item of incoming) {
          if (typeof item?.id === 'number') {
            merged.set(item.id, item)
          }
        }
        return Array.from(merged.values())
      }

      const prevBody = state.messageBodies[assistantKey]
      const nextArtifacts = mergeArtifacts(
        prevBody?.artifacts,
        evt.artifacts as import('@/types').WorkspaceArtifact[],
      )

      const metaIndex = state.messageMetas.findIndex((meta) => messageKey(meta.id) === assistantKey)
      const nextMetas = metaIndex === -1 ? state.messageMetas : state.messageMetas.slice()
      if (metaIndex !== -1) {
        nextMetas[metaIndex] = {
          ...nextMetas[metaIndex],
          artifacts: nextArtifacts,
        }
      }

      const nextBodies = prevBody
        ? {
            ...state.messageBodies,
            [assistantKey]: {
              ...prevBody,
              artifacts: nextArtifacts,
            },
          }
        : state.messageBodies

      return {
        messageMetas: nextMetas,
        messageBodies: nextBodies,
      }
    })
    return
  }

  if (evt?.type === 'content' && evt.content) {
    if (!active.firstChunkAt) {
      active.firstChunkAt = Date.now()
    }
    active.pendingContent += evt.content
    runtime.scheduleFlush(active)
    return
  }

  if (evt?.type === 'reasoning') {
    if (!active.reasoningDesired) return
    // 工具进度不得进入推理通道（与后端硬闸门双保险）
    if (shouldIgnoreReasoningMeta(evt.meta)) return

    const chunkHasContent = typeof evt.content === 'string' && evt.content.length > 0
    if (!active.reasoningActivated && !chunkHasContent && !evt.keepalive) {
      return
    }

    if (!active.reasoningActivated) {
      active.reasoningActivated = true
      active.pendingMeta.reasoningStatus = 'idle'
      active.pendingMeta.reasoningUnavailableCode = null
      active.pendingMeta.reasoningUnavailableReason = null
      active.pendingMeta.reasoningUnavailableSuggestion = null
    }

    if (evt.keepalive) {
      active.pendingMeta.reasoningStatus = 'idle'
      active.pendingMeta.reasoningIdleMs = evt.idleMs ?? null
      runtime.scheduleFlush(active)
      return
    }

    if (evt.content) {
      active.pendingReasoning += evt.content
      active.pendingMeta.reasoningStatus = 'streaming'
      active.pendingMeta.reasoningIdleMs = null
      active.pendingMeta.reasoningUnavailableCode = null
      active.pendingMeta.reasoningUnavailableReason = null
      active.pendingMeta.reasoningUnavailableSuggestion = null
    }

    if (evt.done) {
      active.pendingMeta.reasoningStatus = 'done'
      if (evt.duration != null) {
        active.pendingMeta.reasoningDurationSeconds = evt.duration
      }
    }

    runtime.scheduleFlush(active)
    return
  }

  if (evt?.type === 'reasoning_unavailable') {
    if (!active.reasoningDesired) return
    active.reasoningActivated = true
    active.pendingMeta.reasoningStatus = 'done'
    active.pendingMeta.reasoningIdleMs = null
    active.pendingMeta.reasoningUnavailableCode = evt.unavailableCode ?? null
    active.pendingMeta.reasoningUnavailableReason = evt.unavailableReason ?? null
    active.pendingMeta.reasoningUnavailableSuggestion = evt.unavailableSuggestion ?? null
    runtime.scheduleFlush(active)
    return
  }

  if (evt?.type === 'usage' && evt.usage) {
    const usage = evt.usage
    set((state) => ({
      usageCurrent: {
        prompt_tokens: usage.prompt_tokens,
        context_limit: usage.context_limit ?? state.usageCurrent?.context_limit ?? undefined,
        context_remaining:
          usage.context_remaining ?? state.usageCurrent?.context_remaining ?? undefined,
      },
      usageLastRound:
        usage.completion_tokens != null || usage.total_tokens != null
          ? usage
          : state.usageLastRound,
    }))
    if (active) {
      active.lastUsage = usage as import('../types').StreamUsageSnapshot
    }
    return
  }

  if (evt?.type === 'quota' && evt.quota) {
    useAuthStore.getState().updateQuota(evt.quota)
    return
  }

  if (evt?.type === 'complete') {
    handleCompleteEvent(evt, ctx)
    return
  }
}
