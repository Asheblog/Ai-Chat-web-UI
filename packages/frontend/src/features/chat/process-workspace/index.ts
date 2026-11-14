/**
 * 过程工作区（深模块对外入口）。
 *
 * 消费方只需要两件事：
 * - `ProcessWorkspaceEntry`：替换原 CotTimeline 的摘要入口（props 全量兼容）
 * - `ProcessWorkspaceHost`：包住主聊天 flex 区域，提供 440px 侧栏 / 覆盖 / 全屏
 * 没有宿主时 Entry 自己开本地抽屉，分享、Battle 与任意独立调用点照旧可用。
 */
export { ProcessWorkspaceEntry } from './process-workspace-entry'
export {
  ProcessWorkspaceHost,
  useOptionalProcessWorkspace,
  useProcessWorkspaceOpen,
} from './process-workspace-host'

export type {
  CallLedgerProps,
  ProcessCommandTarget,
  ProcessCoverage,
  ProcessCoverageLayer,
  ProcessCoverageStatus,
  ProcessOrigin,
  ProcessRunTerminal,
  ProcessScope,
  ProcessSnapshot,
  ProcessStatus,
  ProcessStopReason,
  ProcessWorkspaceCommands,
  ProcessWorkspaceEntryProps,
  ProcessWorkspaceHostApi,
  ProcessWorkspaceHostProps,
  ProcessWorkspaceTab,
  ResearchPlanDecision,
  StopToolsAcceptance,
  StopToolsCommandResult,
} from './types'
