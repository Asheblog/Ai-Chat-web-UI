/**
 * 知识库工具处理器适配器
 * 将现有 KBToolHandler 适配为策略模式接口
 */

import { randomUUID } from 'node:crypto'
import { prisma } from '../../../db'
import { KnowledgeBaseService } from '../../../services/knowledge-base/knowledge-base-service'
import { getDocumentServices } from '../../../services/document-services-factory'
import {
  KBToolHandler as LegacyKBToolHandler,
  kbToolDefinitions,
  kbToolNames,
  formatKBToolReasoning,
} from '../kb-tools'
import type { RAGService } from '../../../services/document/rag-service'
import type { EnhancedRAGService } from '../../../services/document/enhanced-rag-service'
import type { DocumentSectionService } from '../../../services/document/section-service'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  KnowledgeBaseHandlerConfig,
} from './types'

export class KnowledgeBaseToolHandlerAdapter implements IToolHandler {
  readonly toolName = 'knowledge_base_tools'
  private config: KnowledgeBaseHandlerConfig
  private legacyHandler: LegacyKBToolHandler | null = null
  private toolNameSet: Set<string>

  constructor(config: KnowledgeBaseHandlerConfig) {
    this.config = config
    this.toolNameSet = kbToolNames
    if (config.ragService && config.knowledgeBaseIds?.length > 0) {
      const docServices = getDocumentServices()
      const sectionService =
        (config.sectionService as DocumentSectionService | null | undefined) ||
        docServices?.sectionService ||
        null
      const enhancedRagService = (config.enhancedRagService as EnhancedRAGService | null | undefined) || null
      this.legacyHandler = new LegacyKBToolHandler(
        new KnowledgeBaseService(prisma),
        config.ragService as RAGService,
        config.knowledgeBaseIds,
        enhancedRagService,
        sectionService,
      )
    }
  }

  get toolDefinition(): ToolDefinition {
    return kbToolDefinitions[0] as ToolDefinition
  }

  get allToolDefinitions(): ToolDefinition[] {
    return kbToolDefinitions as ToolDefinition[]
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
      return this.createErrorResult(callId, toolName, toolCall, 'Knowledge base tool not configured')
    }

    context.emitReasoning(formatKBToolReasoning(toolName, args, 'start'), {
      ...reasoningMeta,
      stage: 'start',
    })
    context.sendToolEvent({
      id: callId,
      tool: toolName,
      stage: 'start',
      query: (args.query as string) || (args.kb_id ? `知识库 ${args.kb_id}` : undefined),
    })

    const result = await this.legacyHandler.handleToolCall(toolName, args)

    if (result.success) {
      context.emitReasoning(formatKBToolReasoning(toolName, args, 'result'), {
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
    }

    const errorMessage = result.error || 'Knowledge base tool failed'
    context.emitReasoning(`知识库工具失败：${errorMessage}`, {
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

  private resolveToolName(toolCall: ToolCall): string {
    const fromFunction = toolCall.function?.name
    if (fromFunction && this.toolNameSet.has(fromFunction)) return fromFunction
    return 'kb_search'
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

export { kbToolNames, kbToolDefinitions }
