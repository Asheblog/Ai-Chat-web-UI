import type { MessageMeta } from '@/types'
import type { ToolLogCoverage } from '@aichat/shared/tool-operations'

/** 消息终态与覆盖字段：服务端/已知值优先，缺失保持原值。 */
export interface MessageOutcomeFields {
  stopReason?: MessageMeta['stopReason']
  finalAnswerGenerated?: MessageMeta['finalAnswerGenerated']
  toolLogCoverage?: ToolLogCoverage
}

/** 覆盖信息是服务端下发的嵌套对象，前端只做透传与等价比较（不重算、不推断完整性）。 */
export const toolLogCoverageEquals = (
  a: ToolLogCoverage | null | undefined,
  b: ToolLogCoverage | null | undefined,
): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

export const resolveOutcomeFields = (
  incoming: MessageOutcomeFields,
  current: MessageOutcomeFields,
): MessageOutcomeFields => ({
  stopReason: incoming.stopReason ?? current.stopReason,
  finalAnswerGenerated: incoming.finalAnswerGenerated ?? current.finalAnswerGenerated,
  toolLogCoverage: incoming.toolLogCoverage ?? current.toolLogCoverage,
})

export const outcomeFieldsChanged = (
  next: MessageOutcomeFields,
  current: MessageOutcomeFields,
): boolean =>
  next.stopReason !== current.stopReason ||
  next.finalAnswerGenerated !== current.finalAnswerGenerated ||
  !toolLogCoverageEquals(next.toolLogCoverage, current.toolLogCoverage)
