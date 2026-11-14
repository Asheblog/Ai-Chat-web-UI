import { resolveEventStatus } from '@aichat/shared/tool-events'
import type { ToolEvent } from '@/types'

/** 与 shared 时间轴失败统计保持同一状态集合。 */
export const isFailedCotToolEvent = (event: ToolEvent) =>
  ['error', 'rejected', 'aborted'].includes(resolveEventStatus(event))
