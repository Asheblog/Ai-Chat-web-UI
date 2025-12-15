/**
 * 文档工具处理器适配器
 * 将现有 DocumentToolHandler 适配为策略模式接口
 */

import { randomUUID } from 'node:crypto'
import {
  DocumentToolHandler as LegacyDocumentToolHandler,
  documentToolDefinitions,
  documentToolNames,
  formatDocumentToolReasoning,
} from '../document-tools'
import type { RAGService } from '../../../services/document/rag-service'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  DocumentHandlerConfig,
} from './types'

export class DocumentToolHandlerAdapter implements IToolHandler {
  readonly toolName = 'document_tools'
  private config: DocumentHandlerConfig
  private legacyHandler: LegacyDocumentToolHandler | null = null
  private toolNameSet: Set<string>

  constructor(config: DocumentHandlerConfig) {
    this.config = config
    this.toolNameSet = documentToolNames
    if (config.ragService) {
      this.legacyHandler = new LegacyDocumentToolHandler(
        config.ragService as RAGService,
        config.sessionId
      )
    }
  }

  get toolDefinition(): ToolDefinition {
    // 返回第一个工具定义作为代表
    return documentToolDefinitions[0] as ToolDefinition
  }

  get allToolDefinitions(): ToolDefinition[] {
    return documentToolDefinitions as ToolDefinition[]
  }

  canHandle(toolName: string): boolean {
    return this.toolNameSet.has(toolName)
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult> {
    const toolName = this.resolveToolName(toolCall)
    const callId = toolCall.id || randomUUID()
    const reasoningMeta = { kind: 'tool', tool: toolName, callId }

    if (!this.legacyHandler) {
      return this.createErrorResult(callId, toolName, toolCall, 'Document tool not configured')
    }

    context.emitReasoning(formatDocumentToolReasoning(toolName, args, 'start'), {
      ...reasoningMeta,
      stage: 'start',
    })
    context.sendToolEvent({
      id: callId,
      tool: toolName,
      stage: 'start',
      query:
        (args.query as string) ||
        (args.page_number ? `第 ${args.page_number} 页` : undefined),
    })

    const result = await this.legacyHandler.handleToolCall(toolName, args)

    if (result.success) {
      context.emitReasoning(formatDocumentToolReasoning(toolName, args, 'result'), {
        ...reasoningMeta,
        stage: 'result',
      })
      context.sendToolEvent({
        id: callId,
        tool: toolName,
        stage: 'result',
        summary: JSON.stringify(result.result).slice(0, 200),
      })
      return {
        toolCallId: callId,
        toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(result.result),
        },
      }
    } else {
      const errorMessage = result.error || 'Document tool failed'
      context.emitReasoning(`文档工具失败：${errorMessage}`, {
        ...reasoningMeta,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: toolName,
        stage: 'error',
        error: errorMessage,
      })
      return {
        toolCallId: callId,
        toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify({ error: errorMessage }),
        },
      }
    }
  }

  private resolveToolName(toolCall: ToolCall): string {
    // 尝试从 toolCall 中获取实际工具名称
    // 这里需要在调用时传入实际工具名
    return 'document_search'
  }

  private createErrorResult(
    callId: string,
    toolName: string,
    toolCall: ToolCall,
    error: string
  ): ToolHandlerResult {
    return {
      toolCallId: callId,
      toolName,
      message: {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify({ error }),
      },
    }
  }
}

// 导出原始工具名称集合供外部使用
export { documentToolNames, documentToolDefinitions }
