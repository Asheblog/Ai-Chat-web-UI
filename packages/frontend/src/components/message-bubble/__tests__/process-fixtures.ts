/**
 * 过程工作区回归测试的共享夹具（非测试文件，vitest 不会当成用例收集）。
 *
 * 只放数据构造与查询助手，不放断言：拆文件时各测试仍各自表达"这条消息发生了什么"。
 */
import { fireEvent, screen, within } from '@testing-library/react'
import type { ProcessCoverage } from '@/features/chat/process-workspace/types'
import type { MessageMeta, ToolEvent } from '@/types'

/** 三层覆盖都确证完整：避免覆盖提示干扰断言。 */
export const completeCoverage: ProcessCoverage = {
  trace: { status: 'complete' },
  persisted: { status: 'complete' },
  projection: { status: 'complete' },
}

export const createMeta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm-1',
  sessionId: 1,
  stableKey: 'stable-cot-1',
  role: 'assistant',
  createdAt: new Date().toISOString(),
  reasoningStatus: 'done',
  ...override,
})

export const toolEvent = (override: Partial<ToolEvent> & Pick<ToolEvent, 'id' | 'tool'>): ToolEvent => ({
  sessionId: 1,
  messageId: 1,
  stage: 'result',
  status: 'success',
  createdAt: Date.now(),
  ...override,
})

/** 第 index 个"普通工具调用"：标题 operation-N、结果 详情-N。 */
export const numberedEvent = (index: number, override: Partial<ToolEvent> = {}): ToolEvent =>
  toolEvent({
    id: 'step-' + index,
    callId: 'call-' + index,
    tool: 'operation-' + index,
    createdAt: index,
    resultText: '详情-' + index,
    ...override,
  })

export const numberedEvents = (count: number): ToolEvent[] =>
  Array.from({ length: count }, (_, index) => numberedEvent(index + 1))

export const buildPlan = (subQuestionCount = 8) => ({
  title: 'AI 芯片竞争格局',
  objective: '梳理厂商路线图、产能与市场份额',
  sub_questions: Array.from({ length: subQuestionCount }, (_, index) => ({
    question: `子问题 ${index + 1}`,
    keywords: [`关键词 ${index + 1}`],
  })),
  estimated_tool_rounds: { min: 3, max: 6 },
  deliverable: 'markdown_report_with_citations_pdf',
})

export const summaryBar = () => screen.getByRole('button', { name: /查看过程/ })
export const openWorkspace = () => fireEvent.click(summaryBar())
export const workspace = () => screen.getByRole('dialog', { name: '本轮工作区' })
export const processList = () => screen.getByRole('list', { name: '过程步骤' })
export const processRows = () => within(processList()).getAllByRole('listitem')
export const reasoningButtons = () => within(workspace()).getAllByRole('button', { name: /深度思考/ })

/** 400 行推理：验证"展开前不挂载原始文本"。 */
export const longReasoning = Array.from({ length: 400 }, (_, index) => `推理第${index}行`).join('\n')

/** 打开工作区并展开第一行，用于调用详情断言。 */
export const openFirstRow = () => {
  openWorkspace()
  fireEvent.click(within(processRows()[0]).getByRole('button'))
}
