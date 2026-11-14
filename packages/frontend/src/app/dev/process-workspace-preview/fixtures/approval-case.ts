/**
 * 审批态：研究计划只有真实审批通道，页面不新造通用工具审批。
 * 计划内容来自 details.plan，待批准调用是 in_flight 而不是失败。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { at, previewEvent, previewMeta } from './primitives'

const target = { sessionId: 24, messageId: 611 }

const PLAN = {
  title: '中国新能源产业政策 2026 年进展梳理',
  objective: '梳理 2026 年中国新能源产业政策的主要变化，并给出可核对的发布机构与时间线。',
  sub_questions: [
    {
      question: '2026 年国家层面新能源产业政策有哪些新发布或修订？',
      keywords: ['新能源', '产业政策', '2026', '发改委'],
    },
    {
      question: '地方配套细则与国家标准之间有哪些衔接差异？',
      keywords: ['地方细则', '国家标准', '衔接', '补贴'],
    },
    {
      question: '政策对制造企业与终端用户的直接影响分别是什么？',
      keywords: ['制造企业', '终端用户', '影响', '成本'],
    },
  ],
  estimated_tool_rounds: { min: 4, max: 8 },
  deliverable: '按政策文件为单位的对照表，附发布机构、生效时间与引用原文段落。',
  notes: '只使用可核对的官方发布渠道；机构解读单独标注，不与政策原文混排。',
}

const events = [
  previewEvent(target, {
    id: 'call_scope_probe',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 400,
    query: '新能源产业政策 2026 发布',
    summary: '范围探测：命中 8 条，其中官方发布渠道 3 条',
    details: { engineCount: 1, hitsCount: 8, taskType: 'search' },
  }),
  previewEvent(target, {
    id: 'call_scope_probe:search:initial',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 460,
    parentCallId: 'call_scope_probe',
    query: '新能源产业政策 2026 发布',
    summary: '并行搜索完成：tavily 命中 8 条',
    details: { engine: 'tavily', hitsCount: 8 },
  }),
  previewEvent(target, {
    id: 'call_research_plan',
    tool: 'research_plan',
    stage: 'start',
    status: 'pending',
    phase: 'pending_approval',
    offset: 1_400,
    query: '提交研究计划等待确认',
    summary: '等待确认：3 个子问题，预计 4—8 轮工具调用',
    details: {
      taskType: 'research_plan',
      plan: PLAN,
      approval: { kind: 'plan', revision: 1 },
      argumentsText: JSON.stringify({ objective: PLAN.objective, subQuestions: PLAN.sub_questions.length }),
    },
  }),
]

const meta = previewMeta({
  stableKey: 'preview-approval-611',
  sessionId: 24,
  id: 611,
  streamStatus: 'streaming',
})

const commands: NonNullable<ProcessWorkspaceEntryProps['commands']> = {
  onResearchPlanDecision: async decision => ({
    fixture: 'dev-research-plan-decision',
    decision,
  }),
}

export const approvalCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: '这个问题需要多轮检索：先确认官方发布渠道，再核对地方细则，最后整理对照表。计划确认前不派发检索任务。',
  toolEvents: events,
  content:
    '这个问题需要多轮检索才能回答，我先给出研究计划，等你确认范围后再开始执行。\n\n计划里列出了 3 个子问题和预计的工具轮次；如果某个子问题不在你关心的范围内，可以直接调整后再批准。',
  coverage: {
    trace: { status: 'complete', startedAt: at(0) },
    persisted: { status: 'partial', asOf: at(1_400) },
    projection: { status: 'complete' },
  },
  isStreaming: true,
  commands,
}
