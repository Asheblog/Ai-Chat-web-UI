/**
 * 过程模型的稳定入口（视图只 import 这里）。
 * 共享契约（@aichat/shared/tool-operations）是唯一实现，本目录不重复投影逻辑。
 */
export {
  buildProcessIndex,
  type ProcessIndex,
  type ProcessIndexSource,
  type ProcessOutcome,
  type ProcessRecord,
  type ProcessRecovery,
  type ProcessRelation,
} from './operation-index'

export {
  describeObservationWindow,
  describeProcessCoverage,
  normalizeProcessCoverage,
  type NormalizedProcessCoverage,
  type ProcessCoverageNote,
  type ProcessCoverageTone,
} from './coverage'

export { buildProcessSummary, type ProcessSummary } from './process-summary'

export {
  EMPTY_PROCESS_FILTER,
  buildProcessRows,
  filterProcessRecords,
  groupProcessAnomalies,
  groupProcessRows,
  type ProcessAnomalyGroup,
  type ProcessAnomalyKind,
  type ProcessFilter,
  type ProcessGrouping,
  type ProcessRow,
  type ProcessRowGroup,
  type ProcessStatusFilter,
} from './derived-views'

export {
  collectProcessSources,
  describeProcessRecord,
  resolveProcessActivity,
  type ProcessRecordLabel,
  type ProcessSource,
} from './record-display'

export {
  COT_TIMELINE_LEVEL_STORAGE_PREFIX,
  COT_TIMELINE_STEPS_STORAGE_PREFIX,
  REASONING_VISIBILITY_STORAGE_KEY,
  TOOL_VISIBILITY_STORAGE_KEY,
  isLevelOpen,
  persistProcessLevel,
  persistProcessSteps,
  persistProcessVisibility,
  readProcessLevel,
  readProcessSteps,
  readProcessVisibility,
  reasoningItemKey,
  toolItemKey,
} from './disclosure'

export {
  describeRunTerminal,
  formatByteSize,
  formatClockTime,
  formatProcessDuration,
  resolveProcessScope,
  resolveProcessScopeKey,
  resolveRunTerminal,
  type ProcessRunTerminalView,
  type ResolveProcessScopeInput,
} from './scope'
