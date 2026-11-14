/**
 * 台账计数直接来自共享契约，视图不再自己算数。
 */
import {
  buildToolOperationSummary,
  type ToolOperationSummary,
} from '@aichat/shared/tool-operations'
import type { ProcessIndex } from './operation-index'

export type ProcessSummary = ToolOperationSummary

export const buildProcessSummary = (index: ProcessIndex): ProcessSummary =>
  buildToolOperationSummary(index)
