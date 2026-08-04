/**
 * 聊天流式 SSE 解析与归一化 —— web / mobile 共用。
 *
 * 合并历史三份重复实现（frontend stream-reader.ts、battle/api.ts、mobile chat-stream-parser.ts）：
 * - normalizeStreamChunk：单条 payload → ChatStreamChunk（含 execution 事件与 legacy 事件全量）
 * - parseStreamLines：增量缓冲逐行解析（mobile 流式读取 / 任意分块场景）
 * - isTerminalSsePayload：判定流结束事件
 *
 * 必须保持 React Native 安全：不依赖 DOM / Node / Buffer API。
 */
import type {
  ChatStreamChunk,
  ToolCallPhase,
  ToolCallSource,
  ToolCallStatus,
  ToolEventDetails,
} from './chat-stream-contract.js'

const TOOL_CALL_PHASES = [
  'arguments_streaming',
  'pending_approval',
  'executing',
  'result',
  'error',
  'rejected',
  'aborted',
] as const

const TOOL_CALL_SOURCES = ['builtin', 'plugin', 'mcp', 'workspace', 'system'] as const

const TOOL_CALL_STATUSES = ['running', 'success', 'error', 'pending', 'rejected', 'aborted'] as const

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const asTextDelta = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const assistantIdFromStepId = (stepId: string | null): number | null => {
  if (!stepId) return null
  const match = /^assistant:(\d+)$/.exec(stepId)
  if (!match) return null
  return asNumber(match[1])
}

export const normalizeToolCallSource = (value: unknown): ToolCallSource | undefined =>
  typeof value === 'string' &&
  TOOL_CALL_SOURCES.includes(value as (typeof TOOL_CALL_SOURCES)[number])
    ? (value as ToolCallSource)
    : undefined

export const normalizeToolCallPhase = (
  phase: unknown,
  status: unknown,
  stage: unknown,
): ToolCallPhase | undefined => {
  if (
    typeof phase === 'string' &&
    TOOL_CALL_PHASES.includes(phase as (typeof TOOL_CALL_PHASES)[number])
  ) {
    return phase as ToolCallPhase
  }
  if (status === 'pending') return 'pending_approval'
  if (status === 'success') return 'result'
  if (status === 'rejected') return 'rejected'
  if (status === 'aborted') return 'aborted'
  if (status === 'error') return 'error'
  if (status === 'running') return 'executing'
  if (stage === 'result') return 'result'
  if (stage === 'error') return 'error'
  if (stage === 'start') return 'executing'
  return undefined
}

export const normalizeToolCallStatus = (
  status: unknown,
  phase: ToolCallPhase | undefined,
  stage: unknown,
): ChatStreamChunk['status'] => {
  if (
    typeof status === 'string' &&
    TOOL_CALL_STATUSES.includes(status as (typeof TOOL_CALL_STATUSES)[number])
  ) {
    return status as ToolCallStatus
  }
  if (phase === 'result') return 'success'
  if (phase === 'error') return 'error'
  if (phase === 'rejected') return 'rejected'
  if (phase === 'aborted') return 'aborted'
  if (phase === 'pending_approval') return 'pending'
  if (stage === 'result') return 'success'
  if (stage === 'error') return 'error'
  return 'running'
}

export const normalizeLegacyStage = (
  stage: unknown,
  phase: ToolCallPhase | undefined,
): 'start' | 'result' | 'error' => {
  if (stage === 'start' || stage === 'result' || stage === 'error') return stage
  if (phase === 'result') return 'result'
  if (phase === 'error' || phase === 'rejected' || phase === 'aborted') return 'error'
  return 'start'
}

const normalizeToolCallFromEvent = (event: Record<string, any>): ChatStreamChunk | null => {
  const phase = normalizeToolCallPhase(event.phase, event.status, event.stage)
  const status = normalizeToolCallStatus(event.status, phase, event.stage)
  const stage = normalizeLegacyStage(event.stage, phase)
  const identifier = asString(event.identifier) || asString(event.tool) || undefined
  const callId = asString(event.callId) || asString(event.id) || undefined
  return {
    type: 'tool_call',
    callId,
    source: normalizeToolCallSource(event.source),
    identifier,
    apiName: asString(event.apiName) || identifier,
    phase,
    status,
    id: asString(event.id) || callId,
    stage,
    query: asString(event.query) || undefined,
    hits: Array.isArray(event.hits) ? event.hits : undefined,
    argumentsText: asString(event.argumentsText) || undefined,
    argumentsPatch: asString(event.argumentsPatch) || undefined,
    resultText: asString(event.resultText) || undefined,
    resultJson: event.resultJson,
    error: asString(event.error) || undefined,
    summary: asString(event.summary) || undefined,
    details:
      event.details && typeof event.details === 'object' ? (event.details as ToolEventDetails) : undefined,
    intervention:
      event.intervention && typeof event.intervention === 'object' ? event.intervention : undefined,
    thoughtSignature:
      typeof event.thoughtSignature === 'string' || event.thoughtSignature === null
        ? event.thoughtSignature
        : undefined,
    meta: event.meta as Record<string, unknown> | undefined,
  }
}

const normalizeExecutionEventChunk = (payload: any): ChatStreamChunk | null => {
  const eventType = asString(payload?.type)
  if (!eventType) return null
  const eventPayload = isRecord(payload?.payload) ? payload.payload : {}

  if (eventType === 'step_delta') {
    const channel = asString(eventPayload.channel)
    const delta = asTextDelta(eventPayload.delta)
    if (!delta) return null
    if (channel === 'reasoning') {
      return { type: 'reasoning', content: delta }
    }
    if (channel === 'content') {
      return { type: 'content', content: delta }
    }
  }

  if (eventType === 'step_start') {
    const stepId = asString(payload?.stepId)
    const metadata = isRecord(eventPayload.metadata) ? eventPayload.metadata : {}
    const assistantMessageId =
      asNumber(metadata.assistantMessageId) ?? assistantIdFromStepId(stepId)
    const assistantClientMessageId =
      asString(metadata.assistantClientMessageId) ??
      (stepId && assistantMessageId == null ? stepId : null)
    const messageId = asNumber(metadata.userMessageId) ?? asNumber(metadata.messageId)

    if (assistantMessageId != null || assistantClientMessageId != null || messageId != null) {
      return {
        type: 'start',
        messageId,
        assistantMessageId,
        assistantClientMessageId,
      }
    }
  }

  if (eventType === 'step_artifact') {
    const kind = asString(eventPayload.kind)
    if (kind === 'tool_call') {
      const data = isRecord(eventPayload.data) ? eventPayload.data : null
      const event = isRecord(data?.event) ? data.event : null
      if (!event) return null
      return normalizeToolCallFromEvent(event)
    }

    if (kind === 'result') {
      const name = asString(eventPayload.name)
      const data = isRecord(eventPayload.data) ? eventPayload.data : null
      if (!name || !data) return null
      if (name === 'image') {
        return {
          type: 'image',
          generatedImages: Array.isArray(data.generatedImages) ? data.generatedImages : undefined,
          messageId: asNumber(data.messageId),
        }
      }
      if (name === 'artifact') {
        return {
          type: 'artifact',
          artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
          messageId: asNumber(data.messageId),
        }
      }
      if (name === 'compression_applied') {
        return {
          type: 'compression_applied',
          compression: data.compression as ChatStreamChunk['compression'],
        }
      }
      if (name === 'reasoning_done') {
        // 推理结束事件：携带推理耗时（秒），供前端推理区块标题展示「· Ns」
        return {
          type: 'reasoning',
          done: true,
          duration: data.duration as number | undefined,
        }
      }
      if (name === 'skill_approval_request' || name === 'skill_approval_result') {
        return {
          ...(data as ChatStreamChunk),
          type: name,
        }
      }
    }
  }

  if (eventType === 'run_metrics') {
    const usage = asRecord(eventPayload.usage)
    if (usage) {
      return { type: 'usage', usage: usage as ChatStreamChunk['usage'] }
    }
  }

  if (eventType === 'run_complete') {
    return { type: 'complete' }
  }

  if (eventType === 'complete') {
    return null
  }

  if (eventType === 'run_error') {
    return {
      type: 'error',
      error: asString(eventPayload.message) || asString(payload?.error) || '工具调用失败，请稍后重试',
    }
  }

  return null
}

/**
 * 归一化单条服务端 payload → ChatStreamChunk。
 * 优先按 execution 事件协议解析，回退到 legacy 事件。
 */
export const normalizeStreamChunk = (payload: any): ChatStreamChunk | null => {
  const executionChunk = normalizeExecutionEventChunk(payload)
  if (executionChunk) {
    return executionChunk
  }
  if (payload?.type === 'complete' && payload?.runId && payload?.eventId) {
    return null
  }
  if (payload?.type === 'content' && payload.content) {
    return { type: 'content', content: payload.content }
  }
  if (payload?.type === 'usage' && payload.usage) {
    return { type: 'usage', usage: payload.usage }
  }
  if (payload?.type === 'reasoning') {
    const chunk: ChatStreamChunk = {
      type: 'reasoning',
      meta: payload.meta,
    }
    if (payload.done) {
      chunk.done = true
      if (typeof payload.duration === 'number') {
        chunk.duration = payload.duration
      }
    } else if (payload.keepalive) {
      chunk.keepalive = true
      if (typeof payload.idle_ms === 'number') {
        chunk.idleMs = payload.idle_ms
      }
    } else if (typeof payload.content === 'string') {
      chunk.content = payload.content
    }
    if (chunk.done || chunk.keepalive || chunk.content) {
      return chunk
    }
    return null
  }
  if (payload?.type === 'reasoning_unavailable') {
    return {
      type: 'reasoning_unavailable',
      unavailableCode: typeof payload.code === 'string' ? payload.code : undefined,
      unavailableReason: typeof payload.reason === 'string' ? payload.reason : undefined,
      unavailableSuggestion: typeof payload.suggestion === 'string' ? payload.suggestion : undefined,
      reasoningProtocol:
        payload.protocol === 'responses' || payload.protocol === 'chat_completions'
          ? payload.protocol
          : undefined,
      reasoningDecision: typeof payload.decision === 'string' ? payload.decision : undefined,
    }
  }
  if (payload?.type === 'tool_call') {
    const event = isRecord(payload) ? payload : null
    if (!event) return null
    return normalizeToolCallFromEvent(event)
  }
  // 生图模型返回的图片
  if (payload?.type === 'image') {
    return {
      type: 'image',
      generatedImages: payload.generatedImages,
      messageId: payload.messageId,
    }
  }
  if (payload?.type === 'artifact' && Array.isArray(payload.artifacts)) {
    return {
      type: 'artifact',
      artifacts: payload.artifacts,
      messageId: payload.messageId,
    }
  }
  if (payload?.type === 'compression_applied' && payload.compression) {
    return {
      type: 'compression_applied',
      compression: payload.compression,
    }
  }
  if (payload?.type === 'start') {
    const normalizedMessageId =
      typeof payload.messageId === 'number'
        ? payload.messageId
        : typeof payload.message_id === 'number'
          ? payload.message_id
          : null
    const normalizedAssistantId =
      typeof payload.assistantMessageId === 'number'
        ? payload.assistantMessageId
        : typeof payload.assistant_message_id === 'number'
          ? payload.assistant_message_id
          : null
    const normalizedAssistantClientId =
      typeof payload.assistantClientMessageId === 'string'
        ? payload.assistantClientMessageId
        : typeof payload.assistant_client_message_id === 'string'
          ? payload.assistant_client_message_id
          : undefined
    return {
      type: 'start',
      messageId: normalizedMessageId,
      assistantMessageId: normalizedAssistantId,
      assistantClientMessageId: normalizedAssistantClientId ?? null,
    }
  }
  if (payload?.type === 'end') {
    return { type: 'end' }
  }
  if (payload?.type === 'complete') {
    return {
      type: 'complete',
      content: typeof payload.content === 'string' ? payload.content : undefined,
    }
  }
  if (payload?.type === 'skill_approval_request') {
    return {
      type: 'skill_approval_request',
      requestId: payload.requestId,
      skillId: payload.skillId,
      skillSlug: payload.skillSlug,
      skillVersionId: payload.skillVersionId,
      tool: payload.tool,
      toolCallId: payload.toolCallId,
      reason: payload.reason,
      expiresAt: payload.expiresAt,
    }
  }
  if (payload?.type === 'skill_approval_result') {
    return {
      type: 'skill_approval_result',
      requestId: payload.requestId,
      skillId: payload.skillId,
      skillSlug: payload.skillSlug,
      tool: payload.tool,
      toolCallId: payload.toolCallId,
      decision: payload.decision,
    }
  }
  if (payload?.type === 'quota' && payload.quota) {
    return { type: 'quota', quota: payload.quota }
  }
  if (payload?.type === 'error') {
    const message =
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error
        : '工具调用失败，请稍后重试'
    return {
      type: 'error',
      error: message,
      errorType: payload.errorType,
      suggestion: payload.suggestion,
    }
  }
  if (payload?.error) {
    // legacy 错误载荷：返回错误 chunk（而非抛出），保证错误对调用方可见
    return { type: 'error', error: String(payload.error) }
  }
  return null
}

/** 判定是否为流终止事件（complete / run_complete / run_error / error） */
export const isTerminalSsePayload = (payload: any): boolean => {
  const type = payload?.type
  return (
    type === 'complete' || type === 'run_complete' || type === 'run_error' || type === 'error'
  )
}

export interface ParsedStreamBatch {
  chunks: ChatStreamChunk[]
  completed: boolean
  remaining: string
  terminated: boolean
}

/**
 * 增量解析 SSE 行缓冲。用于流式读取场景：每次拿到新数据块后调用，
 * 未结束的残行保留在 remaining，下一轮继续。flush=true 强制消费残行。
 */
export function parseStreamLines(buffer: string, flush = false): ParsedStreamBatch {
  const chunks: ChatStreamChunk[] = []
  let completed = false
  let terminated = false
  let remaining = buffer

  while (!terminated) {
    const newlineIndex = remaining.indexOf('\n')
    if (newlineIndex === -1 && !flush) {
      break
    }

    const rawLine = newlineIndex === -1 ? remaining : remaining.slice(0, newlineIndex)
    remaining = newlineIndex === -1 ? '' : remaining.slice(newlineIndex + 1)
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':') || !line.startsWith('data:')) {
      if (newlineIndex === -1) {
        break
      }
      continue
    }

    const payload = line.slice(5).trimStart()
    if (!payload) {
      continue
    }
    if (payload === '[DONE]') {
      completed = true
      terminated = true
      break
    }

    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    const chunk = normalizeStreamChunk(parsed)
    if (!chunk) {
      continue
    }

    chunks.push(chunk)
    if (isTerminalSsePayload(parsed)) {
      completed = true
      if (parsed.type === 'error' || parsed.type === 'run_error') {
        terminated = true
      }
    }
  }

  return { chunks, completed, remaining, terminated }
}
