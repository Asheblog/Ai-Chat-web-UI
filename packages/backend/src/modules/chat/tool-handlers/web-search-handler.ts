/**
 * Web 搜索工具处理器
 */

import { randomUUID } from 'node:crypto'
import { runWebSearch, formatHitsForModel } from '../../../utils/web-search'
import { truncateText } from '../../../utils/parsers'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  WebSearchHandlerConfig,
} from './types'

const parseRequestedLimit = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    return normalized > 0 ? normalized : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

export class WebSearchToolHandler implements IToolHandler {
  readonly toolName = 'web_search'
  private config: WebSearchHandlerConfig

  constructor(config: WebSearchHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Use this tool to search the live web for up-to-date information before responding. Return queries in the same language as the conversation.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query describing the missing information',
            },
          },
          required: ['query'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult> {
    const query = ((args.query as string) || '').trim()
    const callId = toolCall.id || randomUUID()
    const reasoningMetaBase = { kind: 'tool', tool: 'web_search', query, callId }

    if (!query) {
      context.emitReasoning('模型请求了空的联网搜索参数，已忽略。', {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query: '',
        error: 'Model requested web_search without a query',
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ error: 'Missing query parameter' }),
        },
      }
    }

    const modelRequestedLimit = parseRequestedLimit(args.num_results)
    const appliedLimit = this.config.resultLimit

    context.emitReasoning(`联网搜索：${query}（目标 ${appliedLimit} 条）`, {
      ...reasoningMetaBase,
      stage: 'start',
    })
    context.sendToolEvent({
      id: callId,
      tool: 'web_search',
      stage: 'start',
      query,
      details: {
        requestedLimit: modelRequestedLimit,
        appliedLimit,
      },
    })

    try {
      const hits = await runWebSearch(query, {
        engine: this.config.engine,
        apiKey: this.config.apiKey,
        limit: appliedLimit,
        domains: this.config.domains,
        endpoint: this.config.endpoint,
        scope: this.config.scope,
        includeSummary: this.config.includeSummary,
        includeRawContent: this.config.includeRawContent,
      })

      context.emitReasoning(`获得 ${hits.length} 条结果，准备综合。`, {
        ...reasoningMetaBase,
        stage: 'result',
        hits: hits.length,
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits,
        details: {
          requestedLimit: modelRequestedLimit,
          appliedLimit,
        },
      })

      const summary = formatHitsForModel(query, hits)
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query, hits, summary }),
        },
      }
    } catch (searchError: unknown) {
      const message = searchError instanceof Error ? searchError.message : 'Web search failed'
      context.emitReasoning(`联网搜索失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query,
        error: message,
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query, error: message }),
        },
      }
    }
  }
}
