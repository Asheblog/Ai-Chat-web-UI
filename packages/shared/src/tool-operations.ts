/**
 * 工具调用台账共享契约（task-1 冻结接口）。
 *
 * 下游（持久化投影 / 过程工作区 UI / 宿主集成）只从这里取类型与纯函数：
 * - ToolOperationIndex：records / roots / children / orphans / ambiguous
 * - ToolOperationSummary：parentCalls / subtasks / failedOperations / affectedParentCalls ...
 * - ToolLogCoverage：trace / persisted / projection 各自 complete | partial | unknown
 *
 * 身份规则：唯一主键 id；callId 只用于寻找父候选，不合并记录。
 * 结果规则：status 与 outcome / recovery 分离，outcome 只从确证字段推导。
 */
export * from './tool-operation-coverage.js'
export * from './tool-operation-identity.js'
export * from './tool-operation-index.js'
export * from './tool-operation-summary.js'
export type { ToolEvent } from './tool-events.js'
