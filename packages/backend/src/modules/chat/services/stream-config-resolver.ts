/**
 * StreamConfigResolver - 流式配置解析器
 *
 * 统一解析系统设置和环境变量，提供类型安全的流式配置。
 */

import { parseBooleanSetting, parseNumberSetting, clampNumber } from '../../../utils/parsers'

export interface StreamConfig {
  // Usage 配置
  usageEmit: boolean
  usageProviderOnly: boolean

  // 心跳与超时
  heartbeatIntervalMs: number
  providerMaxIdleMs: number
  providerTimeoutMs: number
  providerInitialGraceMs: number
  providerReasoningIdleMs: number
  reasoningKeepaliveIntervalMs: number

  // 推理链配置
  reasoningEnabled: boolean
  reasoningSaveToDb: boolean
  reasoningTagsMode: string
  reasoningCustomTags: [string, string][] | null

  // 流式分块配置
  streamDeltaChunkSize: number
  streamDeltaFlushIntervalMs: number
  streamReasoningFlushIntervalMs: number
  streamKeepaliveIntervalMs: number
  streamProgressPersistIntervalMs: number

  // 并发控制
  maxConcurrentStreams: number
  concurrencyErrorMessage: string

  // Agent 配置
  agentMaxToolIterations: number
  assistantReplyHistoryLimit: number

  // Trace 配置
  traceIdleTimeoutMs: number | null
}

export interface StreamConfigResolverParams {
  sysMap: Record<string, string | undefined>
  env?: NodeJS.ProcessEnv
}

/**
 * 解析流式配置
 */
export function resolveStreamConfig(params: StreamConfigResolverParams): StreamConfig {
  const { sysMap, env = process.env } = params

  const getConfigValue = (sysValue: string | undefined, envKey: string): string | undefined => {
    return sysValue ?? env[envKey]
  }

  const parseIntConfig = (
    sysValue: string | undefined,
    envKey: string,
    options: { min?: number; max?: number; fallback: number }
  ): number => {
    return parseNumberSetting(getConfigValue(sysValue, envKey), options)
  }

  const parseBool = (
    sysValue: string | undefined,
    envKey: string,
    defaultValue: boolean
  ): boolean => {
    return parseBooleanSetting(getConfigValue(sysValue, envKey), defaultValue)
  }

  // Usage 配置
  const usageEmit = parseBool(sysMap.usage_emit, 'USAGE_EMIT', true)
  const usageProviderOnly = parseBool(sysMap.usage_provider_only, 'USAGE_PROVIDER_ONLY', false)

  // 心跳与超时
  const heartbeatIntervalMs = parseIntConfig(
    sysMap.sse_heartbeat_interval_ms,
    'SSE_HEARTBEAT_INTERVAL_MS',
    { fallback: 15000 }
  )
  const providerMaxIdleMs = parseIntConfig(
    sysMap.provider_max_idle_ms,
    'PROVIDER_MAX_IDLE_MS',
    { fallback: 60000 }
  )
  const providerTimeoutMs = parseIntConfig(
    sysMap.provider_timeout_ms,
    'PROVIDER_TIMEOUT_MS',
    { fallback: 120000 }
  )
  const providerInitialGraceMs = parseIntConfig(
    sysMap.provider_initial_grace_ms,
    'PROVIDER_INITIAL_GRACE_MS',
    { min: 0, fallback: 120000 }
  )
  const providerReasoningIdleMs = parseIntConfig(
    sysMap.provider_reasoning_idle_ms,
    'PROVIDER_REASONING_IDLE_MS',
    { min: 0, fallback: 300000 }
  )
  const reasoningKeepaliveIntervalMs = parseIntConfig(
    sysMap.reasoning_keepalive_interval_ms,
    'REASONING_KEEPALIVE_INTERVAL_MS',
    { min: 0, fallback: 0 }
  )

  // 推理链配置
  const reasoningEnabled = parseBool(sysMap.reasoning_enabled, 'REASONING_ENABLED', true)
  const reasoningSaveToDb = parseBool(sysMap.reasoning_save_to_db, 'REASONING_SAVE_TO_DB', true)
  const reasoningTagsMode = (
    sysMap.reasoning_tags_mode ?? env.REASONING_TAGS_MODE ?? 'default'
  ).toString()

  const reasoningCustomTags = (() => {
    try {
      const raw = sysMap.reasoning_custom_tags || env.REASONING_CUSTOM_TAGS || ''
      const arr = raw ? JSON.parse(raw) : null
      if (
        Array.isArray(arr) &&
        arr.length === 2 &&
        typeof arr[0] === 'string' &&
        typeof arr[1] === 'string'
      ) {
        return [[arr[0], arr[1]] as [string, string]]
      }
    } catch {}
    return null
  })()

  // 流式分块配置
  const streamDeltaChunkSize = parseIntConfig(
    sysMap.stream_delta_chunk_size,
    'STREAM_DELTA_CHUNK_SIZE',
    { min: 1, fallback: 1 }
  )
  const streamDeltaFlushIntervalMs = parseIntConfig(
    sysMap.stream_delta_flush_interval_ms,
    'STREAM_DELTA_FLUSH_INTERVAL_MS',
    { min: 0, fallback: 0 }
  )
  const streamReasoningFlushIntervalMs = parseIntConfig(
    sysMap.stream_reasoning_flush_interval_ms,
    'STREAM_REASONING_FLUSH_INTERVAL_MS',
    { min: 0, fallback: streamDeltaFlushIntervalMs }
  )
  const streamKeepaliveIntervalMs = parseIntConfig(
    sysMap.stream_keepalive_interval_ms,
    'STREAM_KEEPALIVE_INTERVAL_MS',
    { min: 0, fallback: 0 }
  )
  const streamProgressPersistIntervalMs = parseIntConfig(
    sysMap.stream_progress_persist_interval_ms,
    'STREAM_PROGRESS_PERSIST_INTERVAL_MS',
    { min: 250, fallback: 800 }
  )

  // 并发控制
  const maxConcurrentStreams = clampNumber(
    parseIntConfig(
      sysMap.chat_max_concurrent_streams,
      'CHAT_MAX_CONCURRENT_STREAMS',
      { fallback: 1 }
    ),
    1,
    8
  )
  const concurrencyErrorMessage = '并发生成数已达系统上限，请稍候重试'

  // Agent 配置
  const agentMaxToolIterations = clampNumber(
    parseIntConfig(
      sysMap.agent_max_tool_iterations,
      'AGENT_MAX_TOOL_ITERATIONS',
      { fallback: 4 }
    ),
    0,
    20
  )

  const assistantReplyHistoryLimit = clampNumber(
    parseIntConfig(
      sysMap.assistant_reply_history_limit,
      'ASSISTANT_REPLY_HISTORY_LIMIT',
      { fallback: 5 }
    ),
    1,
    20
  )

  // Trace 配置 (从 traceDecision 传入，这里设置默认值)
  const traceIdleTimeoutMs = parseIntConfig(
    sysMap.trace_idle_timeout_ms,
    'TRACE_IDLE_TIMEOUT_MS',
    { min: 0, fallback: 0 }
  )

  return {
    usageEmit,
    usageProviderOnly,
    heartbeatIntervalMs,
    providerMaxIdleMs,
    providerTimeoutMs,
    providerInitialGraceMs,
    providerReasoningIdleMs,
    reasoningKeepaliveIntervalMs,
    reasoningEnabled,
    reasoningSaveToDb,
    reasoningTagsMode,
    reasoningCustomTags,
    streamDeltaChunkSize,
    streamDeltaFlushIntervalMs,
    streamReasoningFlushIntervalMs,
    streamKeepaliveIntervalMs,
    streamProgressPersistIntervalMs,
    maxConcurrentStreams,
    concurrencyErrorMessage,
    agentMaxToolIterations,
    assistantReplyHistoryLimit,
    traceIdleTimeoutMs: traceIdleTimeoutMs > 0 ? traceIdleTimeoutMs : null,
  }
}

/**
 * 创建配置解析器实例
 */
export class StreamConfigResolver {
  private cachedConfig: StreamConfig | null = null

  resolve(params: StreamConfigResolverParams): StreamConfig {
    // 每次都重新解析（配置可能动态变化）
    this.cachedConfig = resolveStreamConfig(params)
    return this.cachedConfig
  }

  getCached(): StreamConfig | null {
    return this.cachedConfig
  }
}

// 默认实例
export const streamConfigResolver = new StreamConfigResolver()
