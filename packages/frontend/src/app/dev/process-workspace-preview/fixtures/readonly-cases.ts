/**
 * 只读案例：分享与 Battle 复用同一份树与覆盖，但不允许发聊天命令。
 * 分享用 readOnly + 无 commands；Battle 用 sessionId 0 表示与聊天会话隔离。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import { at, createDevArtifacts, previewEvent, previewMeta } from './primitives'

const shareTarget = { sessionId: 7, messageId: 311 }

const SHARE_HITS = [
  { title: '11月14日新闻早餐丨贵阳最高温超20℃-中国新闻网', url: 'http://www.gz.chinanews.com.cn/qt/2026-11-14/doc-ihfmxyez7339035.shtml', snippet: '今日贵州多地气温回升。' },
  { title: '公共服务事项集中调整', url: 'https://www.gov.cn/zhengce/2026-11/14/content_share.htm', snippet: '过渡期保留线下窗口。' },
  { title: '多地推进线上办理渠道迁移', url: 'https://www.chinanews.com.cn/gn/2026/11-14/doc-preview-01.shtml', snippet: '分批推进，首批覆盖 12 个省份。' },
  { title: '本周经济数据发布时间表', url: 'https://www.news.cn/fortune/2026-11/14/c_preview02.htm', snippet: '周末发布月度数据。' },
  { title: '科研经费管理新规问答', url: 'http://society.people.com.cn/n1/2026/1114/c_preview03.html', snippet: '报销材料与线上流程过渡安排。' },
]


const shareEvents = [
  previewEvent(shareTarget, {
    id: 'call_share_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 500,
    query: '中国新闻 2026年11月14日',
    summary: '搜索完成，自动读取正文 1/1 条',
    details: { engineCount: 1, hitsCount: 5, autoReadRequested: 1, autoReadSucceeded: 1 },
  }),
  // 分享路径同样用同 id 的 start + result，命中只在 result 上：只读面板也要能列出 5 个来源
  previewEvent(shareTarget, {
    id: 'call_share_search:search:initial',
    tool: 'web_search',
    stage: 'start',
    status: 'running',
    offset: 500,
    parentCallId: 'call_share_search',
    query: '中国新闻 2026年11月14日',
    summary: '已派发：tavily 并行搜索',
    details: { engine: 'tavily' },
  }),
  previewEvent(shareTarget, {
    id: 'call_share_search:search:initial',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 560,
    parentCallId: 'call_share_search',
    query: '中国新闻 2026年11月14日',
    summary: '并行搜索完成：tavily 命中 5 条',
    hits: SHARE_HITS,
    details: { engine: 'tavily', hitsCount: 5 },
  }),
  previewEvent(shareTarget, {
    id: 'call_share_read',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 1_800,
    query: 'https://www.gov.cn/zhengce/2026-11/14/content_share.htm',
    summary: '已读取：公共服务事项本周集中调整',
    details: { url: 'https://www.gov.cn/zhengce/2026-11/14/content_share.htm', wordCount: 980 },
  }),
]

export const shareCase: ProcessWorkspaceEntryProps = {
  meta: previewMeta({
    stableKey: 'preview-share-311',
    sessionId: 7,
    id: 311,
    finalAnswerGenerated: true,
  }),
  reasoningRaw: '分享页只展示当时保存的可见推理，不重新请求模型。',
  toolEvents: shareEvents,
  content: [
    '## 分享出去的这一段回答',
    '',
    '分享是只读快照：过程、来源与产物都能展开查看，但不能派发停止工具、取消或重新生成。',
    '',
    '如果这条消息发生在本次改动之前，覆盖信息只能是 unknown；界面据此标未知，而不是显示成完整记录。',
  ].join('\n'),
  coverage: {
    trace: { status: 'unknown' },
    persisted: { status: 'unknown', asOf: at(0) },
    projection: { status: 'unknown' },
  },
  readOnly: true,
  // 分享消息也带产物：只读面板同样要能列出并下载
  artifacts: createDevArtifacts(311),
}

const battleTarget = { sessionId: 0, messageId: 'battle-run-a' }

const battleEvents = [
  previewEvent(battleTarget, {
    id: 'call_battle_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 400,
    query: '比较两种模型对中国新闻的整理方式',
    summary: '搜索完成：命中 6 条，读取正文 1 条',
    details: { engineCount: 1, hitsCount: 6, autoReadRequested: 1, autoReadSucceeded: 1 },
  }),
  previewEvent(battleTarget, {
    id: 'call_battle_search:search:initial',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 460,
    parentCallId: 'call_battle_search',
    query: '比较两种模型对中国新闻的整理方式',
    summary: '并行搜索完成：tavily 命中 6 条',
    details: { engine: 'tavily', hitsCount: 6 },
  }),
  previewEvent(battleTarget, {
    id: 'call_battle_read',
    tool: 'read_url',
    stage: 'error',
    status: 'error',
    offset: 2_200,
    query: 'https://www.chinanews.com.cn/gn/2026/11-14/doc-battle.shtml',
    summary: '网页读取失败，已回退到搜索摘要',
    error: 'Request was cancelled',
    details: { url: 'https://www.chinanews.com.cn/gn/2026/11-14/doc-battle.shtml', fallbackUsed: 'search_snippet' },
  }),
]

export const battleCase: ProcessWorkspaceEntryProps = {
  meta: previewMeta({
    stableKey: 'preview-battle-run-a',
    sessionId: 0,
    id: 'battle-run-a',
    finalAnswerGenerated: true,
  }),
  reasoningRaw: 'Battle 的每个模型 run 只包含自己的调用记录，统计不跨模型相加。',
  toolEvents: battleEvents,
  content: [
    '## 模型 A · 本轮 run',
    '',
    'Battle 详情里每个模型 run 各自一份过程与台账，切换模型不会把两个 run 的记录混在一起。',
    '',
    '这里的会话 id 为 0，所以即使调用方忘了传只读，也不能派发聊天命令。',
  ].join('\n'),
  coverage: {
    trace: { status: 'unknown' },
    persisted: { status: 'partial', asOf: at(2_400), truncatedFields: 3 },
    projection: { status: 'partial' },
  },
  readOnly: true,
}
