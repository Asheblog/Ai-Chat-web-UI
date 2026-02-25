/**
 * 工具处理器模块 - 策略模式实现
 *
 * 导出:
 * - 类型定义
 * - 处理器实现
 * - 注册表和工厂函数
 */

// 类型
export type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolHandlerFactoryParams,
  WebSearchHandlerConfig,
  PythonHandlerConfig,
  UrlReaderHandlerConfig,
  DocumentHandlerConfig,
  KnowledgeBaseHandlerConfig,
  WorkspaceHandlerConfig,
  ToolLogDetails,
} from './types'

// 处理器实现
export { WebSearchToolHandler } from './web-search-handler'
export { PythonToolHandler } from './python-handler'
export { UrlReaderToolHandler } from './url-reader-handler'
export { WorkspaceGitCloneToolHandler } from './workspace-git-clone-handler'
export { WorkspaceListFilesToolHandler } from './workspace-list-files-handler'
export { WorkspaceReadTextToolHandler } from './workspace-read-text-handler'
export {
  DocumentToolHandlerAdapter,
  documentToolNames,
  documentToolDefinitions,
} from './document-handler-adapter'
export {
  KnowledgeBaseToolHandlerAdapter,
  kbToolNames,
  kbToolDefinitions,
} from './knowledge-base-handler-adapter'

// 注册表
export {
  ToolHandlerRegistry,
  createToolHandlerRegistry,
  sendUnsupportedToolError,
} from './registry'
