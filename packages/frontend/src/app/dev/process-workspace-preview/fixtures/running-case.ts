/**
 * 运行态：还有调用在跑，界面必须能停工具、能取消，但所有命令都是交互夹具。
 * 命令返回值里明确写"夹具"，避免被误当成生产接口回执。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { DEV_REASONING, DEV_RUNNING_ANSWER, at, previewEvent, previewMeta } from './primitives'

const target = { sessionId: 21, messageId: 507 }

const events = [
  previewEvent(target, {
    id: 'call_live_zh_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 300,
    query: '中国新闻 2026年11月14日 政策 经济 社会',
    summary: '搜索完成：tavily 命中 6 条，exa 命中 5 条',
    details: { engineCount: 2, hitsCount: 11, autoReadRequested: 2, autoReadSucceeded: 1 },
  }),
  previewEvent(target, {
    id: 'call_live_zh_search:search:tavily',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 360,
    parentCallId: 'call_live_zh_search',
    query: '中国新闻 2026年11月14日 政策 经济 社会',
    summary: '并行搜索完成：tavily 命中 6 条',
    details: { engine: 'tavily', hitsCount: 6 },
  }),
  previewEvent(target, {
    id: 'call_live_zh_search:search:exa',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 420,
    parentCallId: 'call_live_zh_search',
    query: '中国新闻 2026年11月14日 政策 经济 社会',
    summary: '并行搜索完成：exa 命中 5 条',
    details: { engine: 'exa', hitsCount: 5 },
  }),
  previewEvent(target, {
    id: 'call_live_zh_search:read:1',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 1_800,
    parentCallId: 'call_live_zh_search',
    query: 'https://www.gov.cn/zhengce/2026-11/14/content_preview_live.html',
    summary: '已读取：公共服务事项本周集中调整',
    details: {
      url: 'https://www.gov.cn/zhengce/2026-11/14/content_preview_live.html',
      title: '公共服务事项本周集中调整',
      wordCount: 1_204,
    },
  }),
  previewEvent(target, {
    id: 'call_live_zh_search:read:2',
    tool: 'read_url',
    stage: 'start',
    status: 'running',
    phase: 'executing',
    offset: 1_900,
    parentCallId: 'call_live_zh_search',
    query: 'https://www.news.cn/fortune/2026-11/14/c_preview_live2.htm',
    summary: '正在读取正文（已等待 24 秒）',
    details: { url: 'https://www.news.cn/fortune/2026-11/14/c_preview_live2.htm', taskType: 'read_url' },
  }),
  previewEvent(target, {
    id: 'call_live_depth_search',
    tool: 'web_search',
    stage: 'start',
    status: 'running',
    phase: 'executing',
    offset: 2_600,
    query: '科研经费管理新规 过渡期 原文 附件',
    summary: '补充检索第 3 轮：已派发，等待引擎返回',
    details: { engineCount: 2, taskType: 'search' },
  }),
]

const meta = previewMeta({
  stableKey: 'preview-running-507',
  sessionId: 21,
  id: 507,
  reasoningStatus: 'streaming',
  reasoningDurationSeconds: null,
  streamStatus: 'streaming',
})

const commands: NonNullable<ProcessWorkspaceEntryProps['commands']> = {
  onStopTools: async () => ({
    accepted: true,
    reason: '交互夹具：已记录"停止后续工具"，未调用生产接口',
  }),
  onCancelRun: async () => ({ fixture: 'dev-cancel-run' }),
}

export const runningCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: DEV_REASONING,
  toolEvents: events,
  content: DEV_RUNNING_ANSWER,
  coverage: {
    trace: { status: 'complete', startedAt: at(0) },
    persisted: { status: 'partial', asOf: at(2_700), droppedRecords: 0 },
    projection: { status: 'complete' },
  },
  isStreaming: true,
  reasoningPlayedLength: DEV_REASONING.length,
  commands,
}
