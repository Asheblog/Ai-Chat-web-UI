/**
 * StreamConfigResolver - 流式配置解析器
 *
 * 统一解析系统设置和环境变量，提供类型安全的流式配置。
 */

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

  const parseIntWithDefault = (
    sysValue: string | undefined,
    envKey: string,
    defaultValue: number
  ): number => {
    const raw = sysValue ?? env[envKey] ?? String(defaultValue)
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : defaultValue
  }

  const parseBool = (
    sysValue: string | undefined,
    envKey: string,
    defaultValue: boolean
  ): boolean => {
    const raw = sysValue ?? env[envKey] ?? String(defaultValue)
    return raw.toString().toLowerCase() !== 'false'
  }

  const parseBoolStrict = (
    sysValue: string | undefined,
    envKey: string,
    defaultValue: boolean
  ): boolean => {
    const raw = sysValue ?? env[envKey] ?? String(defaultValue)
    return raw.toString().toLowerCase() === 'true'
  }

  // Usage 配置
  const usageEmit = parseBool(sysMap.usage_emit, 'USAGE_EMIT', true)
  const usageProviderOnly = parseBoolStrict(sysMap.usage_provider_only, 'USAGE_PROVIDER_ONLY', false)

  // 心跳与超时
  const heartbeatIntervalMs = parseIntWithDefault(
    sysMap.sse_heartbeat_interval_ms,
    'SSE_HEARTBEAT_INTERVAL_MS',
    15000
  )
  const providerMaxIdleMs = parseIntWithDefault(
    sysMap.provider_max_idle_ms,
    'PROVIDER_MAX_IDLE_MS',
    60000
  )
  const providerTimeoutMs = parseIntWithDefault(
    sysMap.provider_timeout_ms,
    'PROVIDER_TIMEOUT_MS',
    120000
  )
  const providerInitialGraceMs = Math.max(
    0,
    parseIntWithDefault(sysMap.provider_initial_grace_ms, 'PROVIDER_INITIAL_GRACE_MS', 120000)
  )
  const providerReasoningIdleMs = Math.max(
    0,
    parseIntWithDefault(sysMap.provider_reasoning_idle_ms, 'PROVIDER_REASONING_IDLE_MS', 300000)
  )
  const reasoningKeepaliveIntervalMs = Math.max(
    0,
    parseIntWithDefault(sysMap.reasoning_keepalive_interval_ms, 'REASONING_KEEPALIVE_INTERVAL_MS', 0)
  )

  // 推理链配置
  const reasoningEnabled = parseBool(sysMap.reasoning_enabled, 'REASONING_ENABLED', true)
  const reasoningSaveToDb = parseBoolStrict(sysMap.reasoning_save_to_db, 'REASONING_SAVE_TO_DB', true)
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
  const streamDeltaChunkSize = Math.max(
    1,
    parseIntWithDefault(sysMap.stream_delta_chunk_size, 'STREAM_DELTA_CHUNK_SIZE', 1)
  )
  const streamDeltaFlushIntervalMs = Math.max(
    0,
    parseIntWithDefault(sysMap.stream_delta_flush_interval_ms, 'STREAM_DELTA_FLUSH_INTERVAL_MS', 0)
  )
  const streamReasoningFlushIntervalMs = Math.max(
    0,
    parseIntWithDefault(
      sysMap.stream_reasoning_flush_interval_ms,
      'STREAM_REASONING_FLUSH_INTERVAL_MS',
      streamDeltaFlushIntervalMs
    )
  )
  const streamKeepaliveIntervalMs = Math.max(
    0,
    parseIntWithDefault(sysMap.stream_keepalive_interval_ms, 'STREAM_KEEPALIVE_INTERVAL_MS', 0)
  )
  const streamProgressPersistIntervalMs = Math.max(
    250,
    parseIntWithDefault(
      sysMap.stream_progress_persist_interval_ms,
      'STREAM_PROGRESS_PERSIST_INTERVAL_MS',
      800
    )
  )

  // 并发控制
  const maxConcurrentStreamsRaw = parseIntWithDefault(
    sysMap.chat_max_concurrent_streams,
    'CHAT_MAX_CONCURRENT_STREAMS',
    1
  )
  const maxConcurrentStreams = Math.min(8, Math.max(1, maxConcurrentStreamsRaw))
  const concurrencyErrorMessage = '并发生成数已达系统上限，请稍候重试'

  // Agent 配置
  const agentMaxToolIterationsRaw = parseIntWithDefault(
    sysMap.agent_max_tool_iterations,
    'AGENT_MAX_TOOL_ITERATIONS',
    4
  )
  const agentMaxToolIterations = Math.min(20, Math.max(0, agentMaxToolIterationsRaw))

  const assistantReplyHistoryLimitRaw = parseIntWithDefault(
    sysMap.assistant_reply_history_limit,
    'ASSISTANT_REPLY_HISTORY_LIMIT',
    5
  )
  const assistantReplyHistoryLimit = Math.min(20, Math.max(1, assistantReplyHistoryLimitRaw))

  // Trace 配置 (从 traceDecision 传入，这里设置默认值)
  const traceIdleTimeoutMs = parseIntWithDefault(
    sysMap.trace_idle_timeout_ms,
    'TRACE_IDLE_TIMEOUT_MS',
    0
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
