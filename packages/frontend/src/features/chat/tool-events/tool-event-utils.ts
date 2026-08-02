import {
  buildEventKey,
  buildToolSummary,
  compareToolEvents,
  describeTool,
  mergeAndSortToolEvents,
  mergeToolEvents,
  resolveEventStatus,
  resolveReasoningOffsetStart,
  type ToolEvent,
  type ToolTimelineSummary,
} from '@aichat/shared/tool-events'

export type { ToolEvent, ToolTimelineSummary }

/**
 * 工具事件归一化/合并/排序工具。
 * 实现已收敛至 @aichat/shared/tool-events，本模块为兼容转发层。
 */
export {
  buildEventKey,
  buildToolSummary,
  compareToolEvents,
  describeTool,
  mergeAndSortToolEvents,
  mergeToolEvents,
  resolveEventStatus,
  resolveReasoningOffsetStart,
}
