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
            num_results: {
              type: 'integer',
              minimum: 1,
              maximum: this.config.resultLimit,
              description: 'Desired number of results',
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

    context.emitReasoning(`联网搜索：${query}`, { ...reasoningMetaBase, stage: 'start' })
    context.sendToolEvent({ id: callId, tool: 'web_search', stage: 'start', query })

    try {
      const hits = await runWebSearch(query, {
        engine: this.config.engine,
        apiKey: this.config.apiKey,
        limit: (args.num_results as number) || this.config.resultLimit,
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
