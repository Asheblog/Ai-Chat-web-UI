/**
 * 深度研究计划确认流的纯函数助手。
 * 便于独立测试阻塞/终止决策，agent-web-search-response 只负责组装事件与等待。
 */

import { randomUUID } from 'node:crypto'
import type { ToolCall, ToolHandlerResult } from './tool-handlers/types'
import { RESEARCH_PLAN_TOOL_NAME } from './research-plan-tool'

export interface ResearchPlanGateState {
  approved: boolean
  submitted: boolean
  revision: number
  blockedIterations: Set<number>
}

export const createResearchPlanGateState = (): ResearchPlanGateState => ({
  approved: false,
  submitted: false,
  revision: 0,
  blockedIterations: new Set<number>(),
})

export interface ResearchToolBlockDecision {
  block: boolean
  terminal: boolean
}

/**
 * 计划批准前，非 research_plan 工具一律拦截。
 * 同一轮多个工具只计一次违规；累计两轮仍未提交计划则进入终态。
 */
export const decideResearchToolBlock = (
  state: ResearchPlanGateState,
  toolName: string,
  iteration: number,
): ResearchToolBlockDecision => {
  if (state.approved || toolName === RESEARCH_PLAN_TOOL_NAME) {
    return { block: false, terminal: false }
  }
  state.blockedIterations.add(iteration)
  return {
    block: true,
    terminal: state.blockedIterations.size >= 2,
  }
}

export const markResearchPlanSubmitted = (state: ResearchPlanGateState): void => {
  state.submitted = true
}

export const markResearchPlanApproved = (state: ResearchPlanGateState): void => {
  state.approved = true
  state.submitted = true
}

export const markResearchPlanRevised = (state: ResearchPlanGateState, revision: number): void => {
  state.revision = Math.max(0, Math.min(2, revision))
}

const resolveToolCallId = (toolCall: ToolCall): string =>
  (typeof toolCall?.id === 'string' && toolCall.id.trim()) || randomUUID()

export const buildBlockedResearchToolResult = (
  toolCall: ToolCall,
  toolName: string,
  message = '深度研究必须先提交 research_plan 并获得用户确认',
): ToolHandlerResult => {
  const toolCallId = resolveToolCallId(toolCall)
  const name = toolName || 'unknown'
  return {
    toolCallId,
    toolName: name,
    message: {
      role: 'tool',
      tool_call_id: toolCallId,
      name,
      content: JSON.stringify({ error: message }),
    },
  }
}

export const buildResearchPlanRequiredResult = (toolCall: ToolCall, toolName: string): ToolHandlerResult => ({
  ...buildBlockedResearchToolResult(
    toolCall,
    toolName,
    '模型连续两轮未提交 research_plan，深度研究已终止',
  ),
  termination: {
    code: 'research_plan_required',
    message: '模型未按要求提交深度研究计划',
  },
})

export const buildResearchPlanTerminalChunk = (
  code: 'research_plan_cancelled' | 'research_plan_expired',
): { content: string; streamStatus: 'cancelled' } =>
  code === 'research_plan_cancelled'
    ? { content: '深度研究已取消', streamStatus: 'cancelled' }
    : { content: '研究计划已过期，请重新发起深度研究', streamStatus: 'cancelled' }
