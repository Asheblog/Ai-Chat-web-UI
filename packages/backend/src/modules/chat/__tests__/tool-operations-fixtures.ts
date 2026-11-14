import type { ToolEvent } from '@aichat/shared/tool-operations'

/** tool-operations 拆分测试共用的 ToolEvent 构造器（不含断言）。 */
export const event = (override: Partial<ToolEvent> & Pick<ToolEvent, 'id' | 'tool'>): ToolEvent => ({
  sessionId: 1,
  messageId: 1,
  stage: 'start',
  status: 'running',
  createdAt: 1,
  ...override,
})

export const parentCall = (id: string, override: Partial<ToolEvent> = {}): ToolEvent =>
  event({
    id,
    callId: id,
    tool: 'web_search',
    createdAt: 10,
    stage: 'result',
    status: 'success',
    ...override,
  })

export const childOf = (
  parentCallId: string,
  id: string,
  override: Partial<ToolEvent> = {},
): ToolEvent =>
  event({
    id,
    tool: 'read_url',
    createdAt: 11,
    stage: 'result',
    status: 'success',
    details: { parentCallId, autoTriggered: true },
    ...override,
  })
