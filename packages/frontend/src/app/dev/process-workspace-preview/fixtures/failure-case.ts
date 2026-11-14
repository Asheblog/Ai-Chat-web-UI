/**
 * 失败态：失败 / 未获许可 / 中止 / 降级四种情况分开计数，答案是降级而不是失败。
 * 覆盖缺口写实际丢记录与裁字段数，不写百分比。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import {
  DEV_DEGRADED_ANSWER,
  DEV_REASONING,
  at,
  previewEvent,
  previewMeta,
} from './primitives'

const target = { sessionId: 18, messageId: 402 }

const events = [
  previewEvent(target, {
    id: 'call_partial_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 500,
    query: '今日政策 公共服务 调整',
    summary: '搜索完成，自动读取正文 1/2 条',
    details: { engineCount: 2, hitsCount: 9, autoReadRequested: 2, autoReadSucceeded: 1, autoReadFailed: 1 },
  }),
  previewEvent(target, {
    id: 'call_partial_search:search:tavily',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 560,
    parentCallId: 'call_partial_search',
    query: '今日政策 公共服务 调整',
    summary: '并行搜索完成：tavily 命中 5 条',
    details: { engine: 'tavily', hitsCount: 5 },
  }),
  previewEvent(target, {
    id: 'call_partial_search:read:1',
    tool: 'read_url',
    stage: 'error',
    status: 'error',
    offset: 5_400,
    parentCallId: 'call_partial_search',
    query: 'https://www.miamiherald.com/news/business/article318075650.html',
    summary: '网页读取失败，已回退到搜索摘要',
    error: 'Request was cancelled',
    details: {
      url: 'https://www.miamiherald.com/news/business/article318075650.html',
      fallbackUsed: 'search_snippet',
      errorCode: 'cancelled',
      durationMs: 3_400,
      attempts: [
        { engine: 'direct', status: 'error', errorCode: 'cancelled', durationMs: 1_700 },
        { engine: 'reader_proxy', status: 'error', errorCode: 'timeout', durationMs: 1_700 },
      ],
    },
  }),
  previewEvent(target, {
    id: 'call_partial_search:read:2',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 5_900,
    parentCallId: 'call_partial_search',
    query: 'https://www.gov.cn/zhengce/2026-11/14/content_partial.htm',
    summary: '已读取：公共服务事项本周集中调整',
    details: { url: 'https://www.gov.cn/zhengce/2026-11/14/content_partial.htm', wordCount: 1_120 },
  }),
  previewEvent(target, {
    id: 'call_write_blocked',
    tool: 'workspace_write',
    stage: 'error',
    status: 'error',
    phase: 'rejected',
    offset: 7_200,
    query: '写要点整理文件',
    summary: '未获许可：本轮没有写入工作区权限',
    error: 'User rejected workspace_write',
    intervention: { status: 'rejected', rejectedReason: '本轮只做阅读，不写入文件', approvalMode: 'manual' },
    details: { taskType: 'workspace_write', argumentsText: JSON.stringify({ path: '要点整理.md' }) },
  }),
  previewEvent(target, {
    id: 'call_aborted_read',
    tool: 'read_url',
    stage: 'error',
    status: 'aborted',
    phase: 'aborted',
    offset: 8_100,
    query: 'https://www.chinanews.com.cn/gn/2026/11-14/doc-aborted.shtml',
    summary: '已中止：用户取消了本轮剩余读取',
    error: 'aborted by user',
    details: { url: 'https://www.chinanews.com.cn/gn/2026/11-14/doc-aborted.shtml' },
  }),
]

const meta = previewMeta({
  stableKey: 'preview-failure-402',
  sessionId: 18,
  id: 402,
  finalAnswerGenerated: true,
})

const commands: NonNullable<ProcessWorkspaceEntryProps['commands']> = {
  onRegenerate: async () => ({ fixture: 'dev-regenerate' }),
}

export const failureCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: DEV_REASONING,
  toolEvents: events,
  content: DEV_DEGRADED_ANSWER,
  coverage: {
    trace: { status: 'partial', startedAt: at(0), turnEndedAt: at(9_000), truncatedFields: 4 },
    persisted: { status: 'partial', asOf: at(9_500), droppedRecords: 6, truncatedFields: 12 },
    projection: { status: 'complete' },
  },
  runTerminal: { finalAnswerGenerated: true },
  commands,
}
