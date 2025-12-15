/**
 * 工具处理器策略模式 - 类型定义
 */

import type { WebSearchHit } from '../../../utils/web-search'

/**
 * 工具调用参数
 */
export interface ToolCall {
  id?: string
  function?: { arguments?: string }
}

/**
 * 工具日志条目详情
 */
export interface ToolLogDetails {
  code?: string
  input?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  durationMs?: number
  truncated?: boolean
  [key: string]: unknown
}

/**
 * 工具调用上下文 - 处理器需要的环境信息
 */
export interface ToolCallContext {
  sessionId: number
  emitReasoning: (content: string, meta?: Record<string, unknown>) => void
  sendToolEvent: (payload: Record<string, unknown>) => void
}

/**
 * 工具处理结果
 */
export interface ToolHandlerResult {
  toolCallId: string
  toolName: string
  message: {
    role: 'tool'
    tool_call_id: string | undefined
    name: string
    content: string
  }
}

/**
 * 工具处理器接口 - 策略模式核心抽象
 */
export interface IToolHandler {
  readonly toolName: string
  readonly toolDefinition: ToolDefinition
  canHandle(toolName: string): boolean
  handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult>
}

/**
 * OpenAI function calling 格式的工具定义
 */
export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

/**
 * 工具处理器工厂参数
 */
export interface ToolHandlerFactoryParams {
  webSearch?: WebSearchHandlerConfig | null
  python?: PythonHandlerConfig | null
  document?: DocumentHandlerConfig | null
}

/**
 * Web 搜索处理器配置
 */
export interface WebSearchHandlerConfig {
  enabled: boolean
  engine: string
  apiKey?: string
  resultLimit: number
  domains: string[]
  endpoint?: string
  scope?: string
  includeSummary?: boolean
  includeRawContent?: boolean
}

/**
 * Python 处理器配置
 */
export interface PythonHandlerConfig {
  enabled: boolean
  command: string
  args: string[]
  timeoutMs: number
  maxOutputChars: number
  maxSourceChars: number
}

/**
 * 文档处理器配置
 */
export interface DocumentHandlerConfig {
  enabled: boolean
  sessionId: number
  ragService: unknown // 避免循环依赖，使用时再 cast
}

/**
 * 搜索结果格式化函数
 */
export type FormatHitsForModel = (query: string, hits: WebSearchHit[]) => string
