/**
 * 工具处理器注册表 - 管理所有工具处理器
 */

import { randomUUID } from 'node:crypto'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolHandlerFactoryParams,
} from './types'
import { WebSearchToolHandler } from './web-search-handler'
import { PythonToolHandler } from './python-handler'
import { UrlReaderToolHandler } from './url-reader-handler'
import {
  DocumentToolHandlerAdapter,
  documentToolNames,
} from './document-handler-adapter'
import {
  KnowledgeBaseToolHandlerAdapter,
  kbToolNames,
} from './knowledge-base-handler-adapter'

/**
 * 工具处理器注册表
 * 管理工具处理器的注册、查找和执行
 */
export class ToolHandlerRegistry {
  private handlers: IToolHandler[] = []
  private toolNameToHandler = new Map<string, IToolHandler>()

  /**
   * 注册工具处理器
   */
  register(handler: IToolHandler): void {
    this.handlers.push(handler)

    // 特殊处理文档/知识库工具适配器 - 它们管理多个工具
    if (handler instanceof DocumentToolHandlerAdapter) {
      for (const name of documentToolNames) {
        this.toolNameToHandler.set(name, handler)
      }
    } else if (handler instanceof KnowledgeBaseToolHandlerAdapter) {
      for (const name of kbToolNames) {
        this.toolNameToHandler.set(name, handler)
      }
    } else {
      this.toolNameToHandler.set(handler.toolName, handler)
    }
  }

  /**
   * 获取处理器
   */
  getHandler(toolName: string): IToolHandler | undefined {
    return this.toolNameToHandler.get(toolName)
  }

  /**
   * 检查是否有对应处理器
   */
  hasHandler(toolName: string): boolean {
    return this.toolNameToHandler.has(toolName)
  }

  /**
   * 获取所有工具定义
   */
  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = []
    const addedNames = new Set<string>()

    for (const handler of this.handlers) {
      if (handler instanceof DocumentToolHandlerAdapter) {
        // 文档工具有多个定义
        for (const def of handler.allToolDefinitions) {
          if (!addedNames.has(def.function.name)) {
            definitions.push(def)
            addedNames.add(def.function.name)
          }
        }
        continue
      }
      if (handler instanceof KnowledgeBaseToolHandlerAdapter) {
        // 知识库工具有多个定义
        for (const def of handler.allToolDefinitions) {
          if (!addedNames.has(def.function.name)) {
            definitions.push(def)
            addedNames.add(def.function.name)
          }
        }
        continue
      }
      if (!addedNames.has(handler.toolName)) {
        definitions.push(handler.toolDefinition)
        addedNames.add(handler.toolName)
      }
    }

    return definitions
  }

  /**
   * 获取所有允许的工具名称
   */
  getAllowedToolNames(): Set<string> {
    return new Set(this.toolNameToHandler.keys())
  }

  /**
   * 处理工具调用
   */
  async handleToolCall(
    toolName: string,
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult | null> {
    const handler = this.getHandler(toolName)
    if (!handler) {
      return null
    }

    // 对于文档工具，需要传递实际工具名称
    if (handler instanceof DocumentToolHandlerAdapter) {
      // 创建带工具名称的扩展上下文
      const extendedToolCall = { ...toolCall, resolvedToolName: toolName }
      return handler.handle(extendedToolCall, args, context)
    }

    return handler.handle(toolCall, args, context)
  }
}

/**
 * 创建工具处理器注册表
 */
export function createToolHandlerRegistry(
  params: ToolHandlerFactoryParams
): ToolHandlerRegistry {
  const registry = new ToolHandlerRegistry()

  // 注册 Web 搜索处理器
  if (params.webSearch?.enabled) {
    registry.register(new WebSearchToolHandler(params.webSearch))
  }

  // 注册 URL Reader 处理器
  if (params.urlReader?.enabled) {
    registry.register(new UrlReaderToolHandler(params.urlReader))
  }

  // 注册 Python 处理器
  if (params.python?.enabled) {
    registry.register(new PythonToolHandler(params.python))
  }

  // 注册文档处理器
  if (params.document?.enabled && params.document.ragService) {
    registry.register(new DocumentToolHandlerAdapter(params.document))
  }

  // 注册知识库处理器
  if (
    params.knowledgeBase?.enabled &&
    params.knowledgeBase.ragService &&
    params.knowledgeBase.knowledgeBaseIds?.length > 0
  ) {
    registry.register(new KnowledgeBaseToolHandlerAdapter(params.knowledgeBase))
  }

  return registry
}

/**
 * 发送不支持工具错误事件
 */
export function sendUnsupportedToolError(
  toolName: string,
  toolCallId: string | undefined,
  sendToolEvent: (payload: Record<string, unknown>) => void
): void {
  sendToolEvent({
    id: toolCallId || randomUUID(),
    tool: toolName,
    stage: 'error',
    error: 'Unsupported tool requested by the model',
  })
}
