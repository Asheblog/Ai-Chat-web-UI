import type { MessageMeta, ToolEvent } from '@/types'

const BASE_TS = Date.parse('2026-11-11T08:30:00+08:00')

const SEGMENT_TEMPLATES = [
  '先确认用户问的是「中国最新新闻」，需要联网搜索而不是凭记忆回答。',
  '搜索词要尽量具体：时间范围、政策方向、行业关键词都得进查询里。',
  '几个引擎的返回质量差异很大，命中条数只能作为粗筛，后面还要读正文。',
  '这条新闻提到的时间线有点可疑，需要再找一家媒体交叉核对。',
  '用户要的是「最新」，那就把 24 小时内的事件排在前面，旧闻只留背景。',
  '读取正文时要留意发布日期，有些页面是聚合页，抓下来内容其实是旧的。',
  '第一轮搜到的结果偏宏观，补一轮更细的关键词：具体部委、具体数字。',
  '如果两次搜索结果冲突，就在回答里标注两个来源，别硬合成一个结论。',
]

export const buildMockReasoning = (segmentCount = 60) => {
  const segments: string[] = []
  const offsets: number[] = []
  let reasoningRaw = ''
  for (let index = 0; index < segmentCount; index += 1) {
    offsets.push(reasoningRaw.length)
    const template = SEGMENT_TEMPLATES[index % SEGMENT_TEMPLATES.length]
    const segment = `第 ${index + 1} 轮思考：${template} 现在还需要把结论压缩成三到五条，附上可点开的来源。\n`
    segments.push(segment)
    reasoningRaw += segment
  }
  return { segments, offsets, reasoningRaw }
}

const buildSearchGroup = (offset: number, round: number): ToolEvent[] => {
  const events: ToolEvent[] = []
  for (let index = 0; index < 6; index += 1) {
    const seq = round * 10 + index
    const hits = 8 + (seq % 9)
    events.push({
      id: `ws-${seq}`,
      sessionId: 1,
      messageId: 1,
      tool: 'web_search',
      identifier: 'web_search',
      apiName: 'web_search',
      callId: `call-ws-${seq}`,
      stage: 'result',
      status: round === 3 && index === 2 ? 'error' : 'success',
      createdAt: BASE_TS + seq * 1000,
      query: `中国 最新新闻 2026 第 ${round + 1} 轮 · 引擎 ${index + 1}`,
      details: { reasoningOffsetStart: offset, hitsCount: hits },
      summary: `命中 ${hits} 条结果`,
      resultJson: { hits: new Array(hits).fill({ title: '示例结果', url: 'https://example.com' }) },
    })
  }
  for (let index = 0; index < 4; index += 1) {
    const seq = round * 10 + index
    events.push({
      id: `ru-${seq}`,
      sessionId: 1,
      messageId: 1,
      tool: 'read_url',
      identifier: 'read_url',
      apiName: 'read_url',
      callId: `call-ru-${seq}`,
      stage: 'result',
      status: 'success',
      createdAt: BASE_TS + seq * 1000 + 500,
      query: `news.example.com/article/${seq}`,
      details: { reasoningOffsetStart: offset },
      summary: '正文 2.1k 字，发布日期 2026-11-11',
    })
  }
  return events
}

const buildSingleTool = (offset: number, index: number): ToolEvent => ({
  id: `py-${index}`,
  sessionId: 1,
  messageId: 1,
  tool: 'python_runner',
  identifier: 'python_runner',
  apiName: 'python_runner',
  callId: `call-py-${index}`,
  stage: 'result',
  status: 'success',
  createdAt: BASE_TS + index * 1000,
  details: { reasoningOffsetStart: offset },
  summary: '执行 1 个代码块，耗时 0.8s',
  resultText: 'pandas: 3 rows × 2 columns',
})

export const buildMockToolEvents = () => {
  const { offsets } = buildMockReasoning()
  const events: ToolEvent[] = []
  for (let round = 0; round < 40; round += 1) {
    events.push(...buildSearchGroup(offsets[round], round))
  }
  for (let index = 40; index < 60; index += 1) {
    events.push(buildSingleTool(offsets[index], index))
  }
  // 7 个没有 reasoningOffset 的孤儿调用：验证「没有思考段也能列出步骤」
  for (let index = 0; index < 7; index += 1) {
    events.push({
      id: `time-${index}`,
      sessionId: 1,
      messageId: 1,
      tool: 'get_time_info',
      identifier: 'get_time_info',
      apiName: 'get_time_info',
      callId: `call-time-${index}`,
      stage: 'result',
      status: 'success',
      createdAt: BASE_TS + index * 1000,
      summary: '2026-11-11 09:04 (Asia/Singapore)',
    })
  }
  return events
}

export const createMockMeta = (override: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'preview-message',
  sessionId: 1,
  stableKey: 'preview-stable-key',
  role: 'assistant',
  createdAt: new Date(BASE_TS).toISOString(),
  reasoningStatus: 'done',
  reasoningDurationSeconds: 226,
  ...override,
})
