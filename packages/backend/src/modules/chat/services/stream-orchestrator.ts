/**
 * StreamOrchestrator - 流式响应编排器
 *
 * 负责管理流式响应的完整生命周期，协调各子服务的调用。
 * 从 stream.ts 的 ReadableStream 核心逻辑提取。
 */

import type { ChatSession, Connection } from '@prisma/client'
import type { Actor, Message, UsageQuotaSnapshot } from '../../../types'
import type { TaskTraceRecorder, TaskTraceStatus } from '../../../utils/task-trace'
import type { StreamConfig } from './stream-config-resolver'
import type { StreamSseService } from './stream-sse-service'
import type { StreamUsageService, ProviderUsageSnapshot, StreamMetrics } from './stream-usage-service'
import type { StreamTraceService } from './stream-trace-service'
import type { AssistantProgressService } from './assistant-progress-service'
import type { ProviderRequester } from './provider-requester'
import type { NonStreamFallbackService } from './non-stream-fallback-service'
import { createReasoningState, DEFAULT_REASONING_TAGS, extractByTags } from '../../../utils/reasoning-tags'
import { Tokenizer } from '../../../utils/tokenizer'
import { serializeQuotaSnapshot } from '../../../utils/quota'
import { persistAssistantFinalResponse } from '../assistant-message-service'
import {
  registerStreamMeta,
  releaseStreamMeta,
  updateStreamMetaController,
  clearPendingCancelMarkers,
  buildPendingCancelKeyByMessageId,
  buildPendingCancelKeyByClientId,
  hasPendingStreamCancelKey,
  deletePendingStreamCancelKey,
  type AgentStreamMeta,
} from '../stream-state'
import { BackendLogger as log } from '../../../utils/logger'
import { truncateString } from '../../../utils/task-trace'
import { extractOpenAIResponsesStreamEvent } from '../../../utils/openai-responses'

// 会话类型（包含连接信息）
export type ChatSessionWithConnection = ChatSession & {
  connection: Connection
}

// 准备好的请求数据接口
export interface PreparedStreamRequest {
  url: string
  headers: Record<string, string>
  body: string
  timeoutMs: number
}

// 流编排器参数
export interface StreamOrchestratorParams {
  // 会话与演员信息
  session: ChatSessionWithConnection
  actor: Actor
  sessionId: number

  // 消息信息
  userMessage: Message | null
  assistantMessageId: number | null
  assistantClientMessageId: string
  clientMessageId: string | null

  // 请求数据
  preparedRequest: PreparedStreamRequest
  messagesPayload: unknown[]
  requestData: Record<string, unknown>

  // Provider 信息
  provider: 'openai' | 'openai_responses' | 'azure_openai' | 'ollama'
  baseUrl: string
  providerHost: string | null

  // Token 与上下文
  promptTokens: number
  contextLimit: number
  contextRemaining: number

  // 配额
  quotaSnapshot: UsageQuotaSnapshot | null

  // 推理配置
  reasoning: {
    enabled: boolean
    effort: string | null
    ollamaThink: boolean
    saveToDb: boolean
  }

  // 配置
  config: StreamConfig
  sseHeaders: Record<string, string>

  // Trace
  traceRecorder: TaskTraceRecorder
  traceIdleTimeoutMs: number | null

  // 请求信号（用于取消）
  requestSignal?: AbortSignal | null
}

// 流编排器依赖
export interface StreamOrchestratorDeps {
  streamSseService: StreamSseService
  streamUsageService: StreamUsageService
  streamTraceService: StreamTraceService
  assistantProgressService: AssistantProgressService
  providerRequester: ProviderRequester
  nonStreamFallbackService: NonStreamFallbackService
}

/**
 * 流编排器类
 */
export class StreamOrchestrator {
  constructor(private deps: StreamOrchestratorDeps) {}

  /**
   * 创建流式响应
   */
  createStream(params: StreamOrchestratorParams): ReadableStream {
    const {
      session,
      actor,
      sessionId,
      userMessage,
      assistantMessageId: initialAssistantMessageId,
      assistantClientMessageId,
      clientMessageId,
      preparedRequest,
      provider,
      baseUrl,
      providerHost,
      promptTokens,
      contextLimit,
      quotaSnapshot,
      reasoning,
      config,
      traceRecorder,
      traceIdleTimeoutMs,
    } = params

    const requestSignal = params.requestSignal ?? null

    // 可变状态
    let assistantMessageId = initialAssistantMessageId
    let aiResponseContent = ''
    let reasoningBuffer = ''
    const reasoningState = createReasoningState()
    let reasoningDoneEmitted = false
    let reasoningDurationSeconds = 0
    let streamCancelled = false
    let currentProviderController: AbortController | null = null
    let providerUsageSeen = false
    let providerUsageSnapshot: ProviderUsageSnapshot | null = null
    let completionTokensFallback = 0
    let traceStatus: TaskTraceStatus = 'running'
    let traceErrorMessage: string | null = null
    const traceMetadataExtras: Record<string, unknown> = {}

    // 进度持久化状态
    let assistantProgressLastPersistAt = 0
    let assistantProgressLastPersistedLength = 0
    let assistantReasoningPersistLength = 0

    const encoder = new TextEncoder()

    // 注册流元数据
    const activeStreamMeta = registerStreamMeta({
      sessionId,
      actorIdentifier: actor.identifier,
      clientMessageId,
      assistantMessageId,
      assistantClientMessageId,
      maxActorStreams: config.maxConcurrentStreams,
    })

    if (!activeStreamMeta) {
      // 并发限制，返回错误流
      return this.createErrorStream(config.concurrencyErrorMessage, encoder)
    }

    const streamLogBase = () => ({
      sessionId,
      actor: actor.identifier,
      clientMessageId,
      assistantMessageId,
      assistantClientMessageId,
    })

    const bindProviderController = (controller: AbortController | null) => {
      updateStreamMetaController(activeStreamMeta, controller)
    }

    // 取消相关函数
    const pendingCancelKeys = () => {
      const keys: string[] = []
      const messageKey = buildPendingCancelKeyByMessageId(sessionId, assistantMessageId)
      if (messageKey) keys.push(messageKey)
      const assistantClientKey = buildPendingCancelKeyByClientId(sessionId, assistantClientMessageId)
      if (assistantClientKey) keys.push(assistantClientKey)
      const userClientKey = buildPendingCancelKeyByClientId(sessionId, clientMessageId)
      if (userClientKey) keys.push(userClientKey)
      return keys
    }

    const consumePendingCancelMarker = () => {
      let matched = false
      for (const key of pendingCancelKeys()) {
        if (hasPendingStreamCancelKey(key)) {
          deletePendingStreamCancelKey(key)
          matched = true
        }
      }
      return matched
    }

    const markStreamCancelled = () => {
      if (streamCancelled) return
      streamCancelled = true
      if (currentProviderController) {
        try {
          currentProviderController.abort()
        } catch {}
        currentProviderController = null
      }
    }

    const isStreamCancelled = () => {
      if (!streamCancelled && activeStreamMeta?.cancelled) {
        markStreamCancelled()
      }
      if (!streamCancelled && consumePendingCancelMarker()) {
        markStreamCancelled()
      }
      return streamCancelled
    }

    // Usage 提取
    const extractUsageNumbers = (u: unknown): { prompt: number; completion: number; total: number } => {
      try {
        const usage = u as Record<string, unknown>
        const prompt = Number(usage?.prompt_tokens ?? usage?.prompt_eval_count ?? usage?.input_tokens ?? 0) || 0
        const completion = Number(usage?.completion_tokens ?? usage?.eval_count ?? usage?.output_tokens ?? 0) || 0
        const total = Number(usage?.total_tokens ?? (prompt + completion)) || (prompt + completion)
        return { prompt, completion, total }
      } catch {
        return { prompt: 0, completion: 0, total: 0 }
      }
    }

    // 进度持久化
    const persistAssistantProgress = async (options?: {
      force?: boolean
      includeReasoning?: boolean
      status?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled'
      errorMessage?: string | null
    }) => {
      if (!assistantMessageId) return
      const force = options?.force === true
      const includeReasoning = options?.includeReasoning !== false
      const currentReasoning = includeReasoning ? reasoningBuffer : null
      const now = Date.now()
      const deltaLength = aiResponseContent.length - assistantProgressLastPersistedLength
      const reasoningDelta = includeReasoning ? (reasoningBuffer.length - assistantReasoningPersistLength) : 0
      const cancelled = isStreamCancelled()
      if (cancelled && !force && !options?.status) {
        return
      }
      if (!force) {
        const keepaliveExceeded = now - assistantProgressLastPersistAt >= config.streamProgressPersistIntervalMs
        const hasContentDelta = deltaLength >= 8
        const hasReasoningDelta = includeReasoning && reasoningDelta >= 8
        if (!hasContentDelta && !hasReasoningDelta && !keepaliveExceeded) {
          return
        }
      }
      assistantProgressLastPersistAt = now
      assistantProgressLastPersistedLength = aiResponseContent.length
      if (includeReasoning) {
        assistantReasoningPersistLength = reasoningBuffer.length
      }
      const nextStatus = options?.status ?? (cancelled ? 'cancelled' : 'streaming')
      const result = await this.deps.assistantProgressService.persistProgress({
        assistantMessageId,
        sessionId,
        clientMessageId: assistantClientMessageId,
        content: aiResponseContent,
        reasoning: currentReasoning,
        status: nextStatus,
        errorMessage: options?.errorMessage ?? null,
        traceRecorder,
      })
      if (result.recovered && result.messageId) {
        assistantMessageId = result.messageId
      }
    }

    traceRecorder.log('stream:started', { mode: 'standard', provider, baseUrl })

    // 创建 ReadableStream
    const stream = new ReadableStream({
      start: async (controller) => {
        let stopHeartbeat: (() => void) | null = null
        let downstreamAborted = false
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
        let idleWatchTimer: ReturnType<typeof setInterval> | null = null
        let lastChunkTimestamp = Date.now()
        let idleWarned = false

        const emitter = this.deps.streamSseService.createEmitter({
          controller,
          encoder,
          requestSignal: requestSignal as AbortSignal, // 路由层提供
          traceRecorder,
          streamLogBase,
        })

        const markDownstreamClosed = (reason: string) => {
          if (downstreamAborted) return
          downstreamAborted = true
          try {
            emitter.markClosed(reason)
          } catch {}
          try {
            controller.close()
          } catch {}
        }

        const safeEnqueue = (payload: string) => {
          if (downstreamAborted || emitter.isClosed()) return false
          const delivered = emitter.enqueue(payload)
          if (!delivered) {
            markDownstreamClosed('enqueue-closed')
          }
          return delivered
        }

        try {
          // 发送开始事件
          const startEvent = `data: ${JSON.stringify({
            type: 'start',
            messageId: userMessage?.id ?? null,
            assistantMessageId,
            assistantClientMessageId,
          })}\n\n`
          safeEnqueue(startEvent)

          if (quotaSnapshot) {
            const quotaEvent = `data: ${JSON.stringify({
              type: 'quota',
              quota: serializeQuotaSnapshot(quotaSnapshot),
            })}\n\n`
            safeEnqueue(quotaEvent)
          }

          // 初始 usage
          if (config.usageEmit && !config.usageProviderOnly) {
            const usageEvent = `data: ${JSON.stringify({
              type: 'usage',
              usage: {
                prompt_tokens: promptTokens,
                total_tokens: promptTokens,
                context_limit: contextLimit,
                context_remaining: params.contextRemaining,
              },
            })}\n\n`
            emitter.enqueue(usageEvent)
          }

          // 调用 Provider
          const response = await this.deps.providerRequester.requestWithBackoff({
            request: {
              url: preparedRequest.url,
              headers: preparedRequest.headers,
              body: preparedRequest.body,
            },
            context: {
              sessionId,
              provider,
              route: '/api/chat/stream',
              timeoutMs: preparedRequest.timeoutMs,
            },
            traceRecorder,
            traceContext: {
              route: '/api/chat/stream',
              sessionId,
              provider,
              baseUrl,
              model: session.modelRawId,
              connectionId: session.connectionId,
            },
            onControllerReady: (ctrl) => {
              currentProviderController = ctrl
              bindProviderController(ctrl)
            },
            onControllerClear: () => {
              bindProviderController(null)
              currentProviderController = null
            },
          })

          if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(`AI API request failed: ${response.status} ${response.statusText}`)
          }

          const responseBody = response.body
          if (!responseBody) {
            throw new Error('No response body reader')
          }
          reader = responseBody.getReader()

          const decoder = new TextDecoder()
          let buffer = ''
          const requestStartedAt = Date.now()
          let firstChunkAt: number | null = null
          let lastChunkAt: number | null = null
          let providerDone = false
          let pendingVisibleDelta = ''
          let pendingReasoningDelta = ''

          // 解析循环
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const now = Date.now()
            lastChunkAt = now
            lastChunkTimestamp = now
            if (!firstChunkAt) firstChunkAt = now
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const l = line.replace(/\r$/, '')
              if (!l.startsWith('data: ')) continue

              const data = l.slice(6)
              if (data === '[DONE]') {
                // 刷新剩余内容
                if (pendingReasoningDelta) {
                  reasoningBuffer += pendingReasoningDelta
                  const evt = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`
                  safeEnqueue(evt)
                }
                if (pendingVisibleDelta) {
                  aiResponseContent += pendingVisibleDelta
                  const evt = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`
                  safeEnqueue(evt)
                }
                await persistAssistantProgress()
                const endEvent = `data: ${JSON.stringify({ type: 'end' })}\n\n`
                safeEnqueue(endEvent)
                providerDone = true
                break
              }

              let parsed: Record<string, unknown>
              try {
                parsed = JSON.parse(data)
              } catch {
                continue
              }

              const responsesEvent = extractOpenAIResponsesStreamEvent(parsed)
              if (responsesEvent) {
                if (responsesEvent.kind === 'delta') {
                  const deltaReasoning = responsesEvent.reasoningDelta
                  const deltaContent = responsesEvent.contentDelta

                  if (reasoning.enabled && deltaReasoning) {
                    if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
                    pendingReasoningDelta += deltaReasoning
                    if (pendingReasoningDelta.length >= config.streamDeltaChunkSize) {
                      reasoningBuffer += pendingReasoningDelta
                      const evt = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`
                      safeEnqueue(evt)
                      pendingReasoningDelta = ''
                      await persistAssistantProgress({ includeReasoning: true })
                    }
                  }

                  if (deltaContent) {
                    let visible = deltaContent
                    if (reasoning.enabled && config.reasoningTagsMode !== 'off') {
                      const tags =
                        config.reasoningTagsMode === 'custom' && config.reasoningCustomTags
                          ? config.reasoningCustomTags
                          : DEFAULT_REASONING_TAGS
                      const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState)
                      visible = visibleDelta
                      if (reasoningDelta) {
                        if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
                        pendingReasoningDelta += reasoningDelta
                      }
                    }

                    if (visible) {
                      pendingVisibleDelta += visible
                      if (pendingVisibleDelta.length >= config.streamDeltaChunkSize) {
                        aiResponseContent += pendingVisibleDelta
                        const evt = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`
                        safeEnqueue(evt)
                        pendingVisibleDelta = ''
                        await persistAssistantProgress()
                      }
                    }
                  }

                  continue
                }

                if (responsesEvent.kind === 'done') {
                  const usage = responsesEvent.usage
                  if (config.usageEmit && usage) {
                    const nn = extractUsageNumbers(usage)
                    const valid = nn.prompt > 0 || nn.completion > 0 || nn.total > 0
                    if (valid) {
                      providerUsageSeen = true
                      providerUsageSnapshot = usage
                      traceMetadataExtras.finalUsage = usage
                      traceMetadataExtras.providerUsageSource = 'provider'
                    }
                    const usageEvt = `data: ${JSON.stringify({ type: 'usage', usage })}\n\n`
                    safeEnqueue(usageEvt)
                  }

                  // 刷新剩余内容并结束
                  if (pendingReasoningDelta) {
                    reasoningBuffer += pendingReasoningDelta
                    const evt = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`
                    safeEnqueue(evt)
                    pendingReasoningDelta = ''
                  }
                  if (pendingVisibleDelta) {
                    aiResponseContent += pendingVisibleDelta
                    const evt = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`
                    safeEnqueue(evt)
                    pendingVisibleDelta = ''
                  }

                  await persistAssistantProgress({ includeReasoning: true })
                  safeEnqueue(`data: ${JSON.stringify({ type: 'end' })}\n\n`)
                  providerDone = true
                  break
                }

                continue
              }

              // 提取内容
              const choices = parsed.choices as Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }> | undefined
              const deltaContent = choices?.[0]?.delta?.content
              const deltaReasoning = choices?.[0]?.delta?.reasoning_content

              // 处理推理内容
              if (reasoning.enabled && deltaReasoning) {
                if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
                pendingReasoningDelta += deltaReasoning
                if (pendingReasoningDelta.length >= config.streamDeltaChunkSize) {
                  reasoningBuffer += pendingReasoningDelta
                  const evt = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`
                  safeEnqueue(evt)
                  pendingReasoningDelta = ''
                  await persistAssistantProgress({ includeReasoning: true })
                }
              }

              // 处理可见内容
              if (deltaContent) {
                let visible = deltaContent
                if (reasoning.enabled && config.reasoningTagsMode !== 'off') {
                  const tags = config.reasoningTagsMode === 'custom' && config.reasoningCustomTags
                    ? config.reasoningCustomTags
                    : DEFAULT_REASONING_TAGS
                  const { visibleDelta, reasoningDelta } = extractByTags(deltaContent, tags, reasoningState)
                  visible = visibleDelta
                  if (reasoningDelta) {
                    if (!reasoningState.startedAt) reasoningState.startedAt = Date.now()
                    pendingReasoningDelta += reasoningDelta
                  }
                }

                if (visible) {
                  pendingVisibleDelta += visible
                  if (pendingVisibleDelta.length >= config.streamDeltaChunkSize) {
                    aiResponseContent += pendingVisibleDelta
                    const evt = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`
                    safeEnqueue(evt)
                    pendingVisibleDelta = ''
                    await persistAssistantProgress()
                  }
                }
              }

              // Finish reason
              const fr = choices?.[0]?.finish_reason
              if (fr) {
                const stopEvent = `data: ${JSON.stringify({ type: 'stop', reason: fr })}\n\n`
                safeEnqueue(stopEvent)
              }

              // Usage
              if (config.usageEmit && parsed.usage) {
                const nn = extractUsageNumbers(parsed.usage)
                const valid = nn.prompt > 0 || nn.completion > 0 || nn.total > 0
                if (valid) {
                  providerUsageSeen = true
                  providerUsageSnapshot = parsed.usage
                  traceMetadataExtras.finalUsage = parsed.usage
                  traceMetadataExtras.providerUsageSource = 'provider'
                }
                const usageEvt = `data: ${JSON.stringify({ type: 'usage', usage: parsed.usage })}\n\n`
                safeEnqueue(usageEvt)
              }
            }

            if (providerDone) break
          }

          // 刷新剩余
          if (pendingReasoningDelta) {
            reasoningBuffer += pendingReasoningDelta
            const evt = `data: ${JSON.stringify({ type: 'reasoning', content: pendingReasoningDelta })}\n\n`
            safeEnqueue(evt)
          }
          if (pendingVisibleDelta) {
            aiResponseContent += pendingVisibleDelta
            const evt = `data: ${JSON.stringify({ type: 'content', content: pendingVisibleDelta })}\n\n`
            safeEnqueue(evt)
          }

          if (stopHeartbeat) stopHeartbeat()
          bindProviderController(null)
          currentProviderController = null

          // 推理完成事件
          if (reasoning.enabled && !reasoningDoneEmitted && reasoningBuffer.trim()) {
            const endedAt = Date.now()
            if (reasoningState.startedAt) {
              reasoningDurationSeconds = Math.max(0, Math.round((endedAt - reasoningState.startedAt) / 1000))
            }
            const reasoningDoneEvent = `data: ${JSON.stringify({ type: 'reasoning', done: true, duration: reasoningDurationSeconds })}\n\n`
            safeEnqueue(reasoningDoneEvent)
            reasoningDoneEmitted = true
          }

          // 兜底 usage
          if (config.usageEmit && (!config.usageProviderOnly || !providerUsageSeen)) {
            try {
              completionTokensFallback = await Tokenizer.countTokens(aiResponseContent)
            } catch {
              completionTokensFallback = 0
            }
            const fallbackUsagePayload = {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokensFallback,
              total_tokens: promptTokens + completionTokensFallback,
              context_limit: contextLimit,
              context_remaining: Math.max(0, contextLimit - promptTokens),
            }
            const finalUsageEvent = `data: ${JSON.stringify({ type: 'usage', usage: fallbackUsagePayload })}\n\n`
            safeEnqueue(finalUsageEvent)
            traceMetadataExtras.finalUsage = fallbackUsagePayload
            traceMetadataExtras.providerUsageSource = providerUsageSeen ? 'provider' : 'fallback'
          }

          // 完成事件
          const completedAt = Date.now()
          const completeEvent = `data: ${JSON.stringify({
            type: 'complete',
            metrics: {
              firstTokenLatencyMs: firstChunkAt ? firstChunkAt - requestStartedAt : null,
              responseTimeMs: completedAt - requestStartedAt,
            },
          })}\n\n`
          safeEnqueue(completeEvent)
          traceStatus = 'completed'

          // 最终持久化
          try {
            const usageResult = await this.deps.streamUsageService.finalize({
              sessionId,
              modelRawId: session.modelRawId!,
              providerHost,
              assistantMessageId,
              assistantClientMessageId,
              clientMessageId,
              userMessageId: userMessage?.id ?? null,
              content: aiResponseContent,
              reasoningBuffer,
              reasoningDurationSeconds,
              promptTokens,
              completionTokensFallback,
              contextLimit,
              providerUsageSeen,
              providerUsageSnapshot,
              reasoningEnabled: reasoning.enabled,
              reasoningSaveToDb: reasoning.saveToDb,
              assistantReplyHistoryLimit: config.assistantReplyHistoryLimit,
              traceRecorder,
              timing: { requestStartedAt, firstChunkAt, completedAt },
              precomputedMetrics: undefined,
            })
            assistantMessageId = usageResult.assistantMessageId
          } catch (err) {
            log.warn('Persist final assistant response failed:', err)
          }

        } catch (error) {
          bindProviderController(null)
          currentProviderController = null

          if (activeStreamMeta?.cancelled) {
            streamCancelled = true
            await persistAssistantProgress({ force: true, status: 'cancelled', errorMessage: 'Cancelled by user' })
            traceStatus = 'cancelled'
            traceRecorder.log('stream:cancelled', { sessionId, assistantMessageId })
            return
          }

          traceStatus = 'error'
          traceErrorMessage = error instanceof Error ? error.message : 'Streaming error'
          traceRecorder.log('stream:error', { message: traceErrorMessage })

          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          const errorEvent = `data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`
          safeEnqueue(errorEvent)
          await persistAssistantProgress({ force: true, status: 'error', errorMessage })
        } finally {
          try {
            ;(stopHeartbeat as (() => void) | null)?.()
            controller.close()
          } catch {}
          if (idleWatchTimer) {
            clearInterval(idleWatchTimer)
          }
          bindProviderController(null)
          currentProviderController = null
          releaseStreamMeta(activeStreamMeta)
          clearPendingCancelMarkers({
            sessionId,
            messageId: assistantMessageId,
            clientMessageId,
            assistantClientMessageId,
          })

          const finalMetadata = {
            ...traceMetadataExtras,
            messageId: assistantMessageId,
          }
          if (traceErrorMessage) {
            (finalMetadata as Record<string, unknown>).error = traceErrorMessage
          }
          const finalStatus = traceStatus === 'running'
            ? (traceErrorMessage ? 'error' : 'completed')
            : traceStatus
          await traceRecorder.finalize(finalStatus, { metadata: finalMetadata })
        }
      },
    })

    return stream
  }

  /**
   * 创建错误流（并发限制时使用）
   */
  private createErrorStream(message: string, encoder: InstanceType<typeof TextEncoder>): ReadableStream {
    return new ReadableStream({
      start(controller) {
        const errorEvent = `data: ${JSON.stringify({ type: 'error', error: message })}\n\n`
        controller.enqueue(encoder.encode(errorEvent))
        controller.close()
      },
    })
  }
}

// 默认实例
let streamOrchestratorInstance: StreamOrchestrator | null = null

export const getStreamOrchestrator = (): StreamOrchestrator => {
  if (!streamOrchestratorInstance) {
    throw new Error('StreamOrchestrator not initialized')
  }
  return streamOrchestratorInstance
}

export const setStreamOrchestrator = (orchestrator: StreamOrchestrator) => {
  streamOrchestratorInstance = orchestrator
}

export const initStreamOrchestrator = (deps: StreamOrchestratorDeps): StreamOrchestrator => {
  streamOrchestratorInstance = new StreamOrchestrator(deps)
  return streamOrchestratorInstance
}
