/**
 * 工具日志对外入口（兼容层）。
 *
 * 实现在 services/chat/tool-log-*：services 层不能 import modules/chat，
 * 而分享/Battle 投影都需要同一份持久化与读取逻辑，故实现在 services 并由本文件转出。
 * 既有 import 路径（'./tool-logs'、'../tool-logs'）保持不变。
 */
export type {
  ToolLogDetails,
  ToolLogEntry,
  ToolLogRunResult,
  ToolLogStage,
  ToolLogStatus,
  ToolRunStopReason,
} from '../../services/chat/tool-log-model'
export {
  TOOL_LOG_ENTRY_FIELDS,
  TOOL_LOG_LIMITS,
  TOOL_LOG_PRESERVED_DETAIL_KEYS,
  isToolLogStatus,
  resolveToolLogStatus,
} from '../../services/chat/tool-log-model'
export {
  TOOL_LOG_ENVELOPE_VERSION,
  sanitizeToolLogEntryForPersistence,
  serializeToolLogsForPersistence,
  type ToolLogPersistenceOptions,
} from '../../services/chat/tool-log-persistence'
export {
  parseToolLogsJson,
  parseToolLogsPayloadJson,
  resolveMessageToolLogCoverage,
  resolveToolLogTerminalOutcome,
  type ParseToolLogsMode,
  type ParseToolLogsOptions,
  type ParsedToolLogsPayload,
  type ToolLogTerminalOutcome,
} from '../../services/chat/tool-log-parse'
export { projectToolEventsForHistoryList } from '../../services/chat/tool-log-projection'
export type { ToolLogCoverage, ToolLogCoverageLayer, ToolCoverageStatus } from '@aichat/shared/tool-operations'
