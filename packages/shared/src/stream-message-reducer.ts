/**
 * 流式消息归约器 —— web / mobile 共用的纯函数集合。
 *
 * 收敛 frontend stream-slice 与 mobile chat-message-utils 两份重复实现：
 * - contentToText：API 消息 content（字符串或结构化对象）归一化为展示文本
 * - appendContentText / appendReasoningText / shouldAppendReasoningDelta：流式增量拼接
 * - upsertToolEventFromChunk：ChatStreamChunk(tool_call) → ToolEvent[] 增量 upsert
 *
 * 必须保持 React Native 安全：不依赖 DOM / Node / Buffer API。
 */
import type {
  ChatStreamChunk,
  ToolEventDetails,
  ToolEventStage,
} from './chat-stream-contract.js'
import {
  normalizeLegacyStage,
  normalizeToolCallPhase,
  normalizeToolCallSource,
  normalizeToolCallStatus,
} from './chat-stream-parser.js'
import { shouldIgnoreReasoningMeta } from './strip-tool-progress-from-reasoning.js'
import {
  applyReasoningOffsetsToDetails,
  type ToolEvent,
} from './tool-events.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * 将 API 消息 content（string 或 { text / content } 结构化对象）归一化为文本。
 * 与 mobile 历史 contentToText 行为保持一致。
 */
export const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const maybeText =
      (content as { text?: unknown; content?: unknown }).text ??
      (content as { content?: unknown }).content
    if (typeof maybeText === 'string') return maybeText
  }
  return ''
}

/** 拼接流式 content delta（mobile appendAssistantContent 的核心）。 */
export const appendContentText = (current: unknown, delta: string): string =>
  `${contentToText(current)}${delta}`

/** 拼接流式 reasoning delta（mobile appendAssistantReasoning 的核心）。 */
export const appendReasoningText = (
  current: string | null | undefined,
  delta: string,
): string => `${current ?? ''}${delta}`

/** reasoning meta 为工具进度时忽略 delta（与后端硬闸门双保险）。 */
export const shouldAppendReasoningDelta = (
  meta?: Record<string, unknown> | null,
): boolean => !shouldIgnoreReasoningMeta(meta)

export interface ToolEventUpsertContext {
  sessionId: number
  messageId: number | string
  /** 当前 assistant 消息的推理文本长度（不含 pending），用于回填 reasoningOffset* */
  reasoningLength: number
  nowMs?: number
}

/**
 * 将一个归一化后的 tool_call chunk upsert 进 ToolEvent 列表。
 *
 * - 按 callId/id + sessionId 查找既有事件
 * - 归一化 phase/stage/status/source
 * - 合并 details 并回填 reasoningOffsetStart/End/offset
 * - 返回新列表（即使未匹配也会返回切片副本）
 *
 * 不在此处排序：web 由 useToolTimeline 合并排序，mobile 由调用方
 * 使用 mergeAndSortToolEvents 排序，保持两端既有消费行为。
 */
export const upsertToolEventFromChunk = <T extends ToolEvent = ToolEvent>(
  events: readonly T[],
  chunk: ChatStreamChunk,
  context: ToolEventUpsertContext,
): T[] => {
  const { sessionId, messageId, reasoningLength, nowMs = Date.now() } = context
  const list = events.slice() as T[]

  const rawCallId =
    typeof chunk.callId === 'string' && chunk.callId.trim().length > 0
      ? chunk.callId.trim()
      : typeof chunk.id === 'string' && chunk.id.trim().length > 0
        ? chunk.id.trim()
        : ''
  const eventId = rawCallId || `tool:${sessionId}:${nowMs}`
  const idx = list.findIndex((item) => {
    if (item.sessionId !== sessionId) return false
    if (rawCallId && item.callId === rawCallId) return true
    return item.id === eventId
  })
  const previous = idx === -1 ? null : list[idx]

  const phase = normalizeToolCallPhase(chunk.phase, chunk.status, chunk.stage)
  const stage = normalizeLegacyStage(chunk.stage, phase)
  const status = normalizeToolCallStatus(chunk.status, phase, stage)
  const source = normalizeToolCallSource(chunk.source)

  const reasoningLengthAtEvent = Math.max(0, reasoningLength)
  const detailPayload =
    chunk.details && isRecord(chunk.details)
      ? (chunk.details as unknown as ToolEventDetails)
      : undefined
  const prevDetails = previous?.details
  const mergedDetails: ToolEventDetails = {
    ...(prevDetails ?? {}),
    ...(detailPayload ? { ...detailPayload } : {}),
  }

  if (typeof chunk.argumentsText === 'string') {
    mergedDetails.argumentsText = chunk.argumentsText
  }
  if (typeof chunk.argumentsPatch === 'string') {
    mergedDetails.argumentsPatch = chunk.argumentsPatch
  }
  if (typeof chunk.resultText === 'string') {
    mergedDetails.resultText = chunk.resultText
  }
  if (typeof chunk.resultJson !== 'undefined') {
    mergedDetails.resultJson = chunk.resultJson
  }

  const nextDetails = applyReasoningOffsetsToDetails(
    mergedDetails,
    reasoningLengthAtEvent,
    stage as ToolEventStage,
    idx === -1,
  )

  const identifier =
    typeof chunk.identifier === 'string' && chunk.identifier.trim().length > 0
      ? chunk.identifier.trim()
      : typeof chunk.apiName === 'string' && chunk.apiName.trim().length > 0
        ? chunk.apiName.trim()
        : previous?.identifier
  const toolName = identifier || previous?.tool || 'web_search'
  const apiName =
    typeof chunk.apiName === 'string' && chunk.apiName.trim().length > 0
      ? chunk.apiName.trim()
      : previous?.apiName || identifier || toolName

  const next: ToolEvent = {
    id: eventId,
    sessionId,
    messageId,
    tool: toolName,
    stage,
    status: status ?? 'running',
    query: typeof chunk.query === 'string' ? chunk.query : previous?.query,
    hits: (Array.isArray(chunk.hits) ? chunk.hits : previous?.hits) as ToolEvent['hits'],
    error: typeof chunk.error === 'string' ? chunk.error : previous?.error,
    summary: typeof chunk.summary === 'string' ? chunk.summary : previous?.summary,
    createdAt: previous?.createdAt ?? nowMs,
    details:
      nextDetails && Object.keys(nextDetails).length > 0 ? nextDetails : undefined,
    callId: rawCallId || previous?.callId || eventId,
    identifier: identifier || undefined,
    apiName: apiName || undefined,
    source: source ?? previous?.source,
    phase: phase ?? previous?.phase,
    argumentsText:
      typeof chunk.argumentsText === 'string' ? chunk.argumentsText : previous?.argumentsText,
    argumentsPatch:
      typeof chunk.argumentsPatch === 'string' ? chunk.argumentsPatch : previous?.argumentsPatch,
    resultText:
      typeof chunk.resultText === 'string' ? chunk.resultText : previous?.resultText,
    resultJson:
      typeof chunk.resultJson !== 'undefined' ? chunk.resultJson : previous?.resultJson,
    intervention:
      chunk.intervention && isRecord(chunk.intervention)
        ? (chunk.intervention as ToolEvent['intervention'])
        : previous?.intervention,
    thoughtSignature:
      typeof chunk.thoughtSignature === 'string' || chunk.thoughtSignature === null
        ? chunk.thoughtSignature
        : previous?.thoughtSignature,
    updatedAt: nowMs,
  }

  if (idx === -1) {
    list.push(next as T)
  } else {
    list[idx] = {
      ...previous,
      ...next,
    } as T
  }

  return list
}
