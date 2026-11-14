/**
 * 完成态：4 个父调用 + 8 个子任务 = 12 条记录，4 阶段 · 12 次调用。
 * 来源是 18 条引用命中、去重后 12 个 URL；产物是 2 个真实可下载的 dev 示例文件。
 */
import type { ProcessWorkspaceEntryProps } from '@/features/chat/process-workspace/types'
import type { WebSearchHit } from '@/types'
import {
  DEV_ANSWER,
  DEV_REASONING,
  at,
  createDevArtifacts,
  previewEvent,
  previewMeta,
} from './primitives'

const target = { sessionId: 12, messageId: 184 }

const hit = (index: number, title: string, url: string, snippet: string): WebSearchHit => ({
  title,
  url,
  snippet,
  imageUrl: index % 4 === 0 ? `https://img.example.dev/preview/${index}.jpg` : undefined,
})

const ZH_TAVILY: WebSearchHit[] = [
  hit(1, '11月14日新闻早餐丨贵阳最高温超20℃-中国新闻网—贵州新闻', 'http://www.gz.chinanews.com.cn/qt/2026-11-14/doc-ihfmxyez7339035.shtml', '今日贵州多地气温回升，公共服务窗口办理时间同步调整。'),
  hit(2, '国务院政策例行吹风会：公共服务事项集中调整', 'https://www.gov.cn/zhengce/2026-11/14/content_9f2c1b7ad4e34c0f8f3a5c6b7de8a912.html', '本周起部分公共服务事项办理渠道迁移至线上，过渡期保留线下窗口。'),
  hit(3, '中国新闻网：多地推进线上办理渠道迁移', 'https://www.chinanews.com.cn/gn/2026/11-14/doc-preview-01.shtml', '迁移工作分批推进，首批覆盖 12 个省份。'),
  hit(4, '新华社：本周经济数据发布时间表', 'https://www.news.cn/fortune/2026-11/14/c_preview02.htm', '统计局将于本周末发布月度数据，机构解读随后跟进。'),
  hit(5, '人民网：科研经费管理新规问答', 'http://society.people.com.cn/n1/2026/1114/c_preview03.html', '新规对报销材料与线上流程给出过渡安排。'),
  hit(6, '光明网：公共服务线上化过渡期安排', 'https://politics.gmw.cn/2026-11/14/content_preview04.htm', '过渡期内线上未通的地区继续保留窗口。'),
]

const ZH_EXA: WebSearchHit[] = [
  hit(3, '中国新闻网：多地推进线上办理渠道迁移', 'https://www.chinanews.com.cn/gn/2026/11-14/doc-preview-01.shtml', '同一来源在第二引擎再次命中，去重后只保留一条。'),
  hit(4, '新华社：本周经济数据发布时间表', 'https://www.news.cn/fortune/2026-11/14/c_preview02.htm', '同一来源在第二引擎再次命中。'),
  hit(5, '人民网：科研经费管理新规问答', 'http://society.people.com.cn/n1/2026/1114/c_preview03.html', '同一来源在第二引擎再次命中。'),
  hit(6, '光明网：公共服务线上化过渡期安排', 'https://politics.gmw.cn/2026-11/14/content_preview04.htm', '同一来源在第二引擎再次命中。'),
  hit(7, '经济日报：产业动态与地区样本说明', 'https://www.ce.cn/xwzx/preview-05.shtml', '原文只给出抽样说明，未给出全省口径。'),
  hit(8, '第一财经：机构解读口径差异提醒', 'https://www.yicai.com/news/preview-06.html', '同比与环比口径不同，不建议直接对比。'),
]

const EN_HITS: WebSearchHit[] = [
  hit(9, 'CGTN | Breaking News, China News, World News and Video', 'https://www.cgtn.com', 'China news roundup for November 14, 2026.'),
  hit(10, 'China Daily: Policy briefing highlights', 'https://www.chinadaily.com.cn/a/preview-07.html', 'Public service channels migrate online with a transition window.'),
  hit(11, 'VOA Chinese: 每日新闻汇总', 'https://www.voachinese.com/z/1739', '新闻汇总页，需核对发布时间。'),
]

const CROSS_HITS: WebSearchHit[] = [
  hit(12, '中国政府网：政策原文索引页', 'https://www.gov.cn/zhengce/preview-08/index.htm', '原文索引，含附件清单。'),
  hit(1, '11月14日新闻早餐丨贵阳最高温超20℃-中国新闻网—贵州新闻', 'http://www.gz.chinanews.com.cn/qt/2026-11-14/doc-ihfmxyez7339035.shtml', '跨轮次重复命中同一来源，去重后只保留一条。'),
  hit(2, '国务院政策例行吹风会：公共服务事项集中调整', 'https://www.gov.cn/zhengce/2026-11/14/content_9f2c1b7ad4e34c0f8f3a5c6b7de8a912.html', '跨轮次重复命中同一来源。'),
]

const events = [
  previewEvent(target, {
    id: 'call_zh_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 640,
    query: '中国新闻 2026年11月14日',
    summary: '搜索完成，自动读取正文 2/2 条',
    details: {
      engineCount: 2,
      queryCount: 1,
      hitsCount: 12,
      autoReadEnabled: true,
      autoReadRequested: 2,
      autoReadSucceeded: 2,
      autoReadFailed: 0,
      taskType: 'search',
    },
    resultText: '两个引擎并行搜索，共命中 12 条（去重后 7 个来源），自动读取正文 2 条。',
  }),
  // 同 id 的 start + result：命中只写在 result 上，合并后必须仍然拿得到（来源面板依赖）
  previewEvent(target, {
    id: 'call_zh_search:search:tavily',
    tool: 'web_search',
    stage: 'start',
    status: 'running',
    offset: 620,
    parentCallId: 'call_zh_search',
    query: '中国新闻 2026年11月14日',
    summary: '已派发：tavily 并行搜索',
    details: { engine: 'tavily', taskType: 'search', queryIndex: 0 },
  }),
  previewEvent(target, {
    id: 'call_zh_search:search:tavily',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 700,
    parentCallId: 'call_zh_search',
    query: '中国新闻 2026年11月14日',
    summary: '并行搜索完成：tavily 命中 6 条',
    hits: ZH_TAVILY,
    details: { engine: 'tavily', hitsCount: 6, taskType: 'search', queryIndex: 0 },
  }),
  previewEvent(target, {
    id: 'call_zh_search:search:exa',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 760,
    parentCallId: 'call_zh_search',
    query: '中国新闻 2026年11月14日',
    summary: '并行搜索完成：exa 命中 6 条',
    hits: ZH_EXA,
    details: { engine: 'exa', hitsCount: 6, taskType: 'search', queryIndex: 0 },
  }),
  previewEvent(target, {
    id: 'call_zh_search:read:1',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 2_400,
    parentCallId: 'call_zh_search',
    query: ZH_TAVILY[0].url,
    summary: '已读取：11月14日新闻早餐丨贵阳最高温超20℃-中国新闻网—贵州新闻',
    details: {
      url: ZH_TAVILY[0].url,
      title: ZH_TAVILY[0].title,
      wordCount: 1_842,
      siteName: '中国新闻网',
      taskType: 'read_url',
      byline: '贵州新闻 · 2026-11-14 08:12',
    },
    resultText: '正文 1842 字，含发布时间与发布机构，可用于引用。',
  }),
  previewEvent(target, {
    id: 'call_zh_search:read:2',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 2_460,
    parentCallId: 'call_zh_search',
    query: 'https://www.gov.cn/zhengce/2026-11/14/content_9f2c1b7ad4e34c0f8f3a5c6b7de8a912.html',
    summary: '已读取：国务院政策例行吹风会：公共服务事项集中调整',
    details: {
      url: 'https://www.gov.cn/zhengce/2026-11/14/content_9f2c1b7ad4e34c0f8f3a5c6b7de8a912.html',
      title: '国务院政策例行吹风会：公共服务事项集中调整',
      wordCount: 3_206,
      siteName: '中国政府网',
      taskType: 'read_url',
    },
    resultText: '正文 3206 字，含附件清单；附件中纸质材料条款与"全程线上"表述存在出入。',
  }),
  previewEvent(target, {
    id: 'call_en_search',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 3_100,
    query: 'China news November 14 2026',
    summary: '搜索完成，自动读取正文 1/1 条',
    details: { engineCount: 1, hitsCount: 3, autoReadRequested: 1, autoReadSucceeded: 1 },
  }),
  previewEvent(target, {
    id: 'call_en_search:search:initial',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 3_140,
    parentCallId: 'call_en_search',
    query: 'China news November 14 2026',
    summary: '并行搜索完成：tavily 命中 3 条',
    hits: EN_HITS,
    details: { engine: 'tavily', hitsCount: 3, queryLanguage: 'en' },
  }),
  previewEvent(target, {
    id: 'call_en_search:read:1',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 4_200,
    parentCallId: 'call_en_search',
    query: EN_HITS[0].url,
    summary: '已读取：CGTN | Breaking News, China News, World News and Video',
    details: { url: EN_HITS[0].url, title: EN_HITS[0].title, wordCount: 968, siteName: 'CGTN' },
  }),
  previewEvent(target, {
    id: 'call_crosscheck',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 8_800,
    query: '公共服务 线上办理 过渡期 原文',
    summary: '搜索完成，自动读取正文 1/1 条',
    details: { engineCount: 1, hitsCount: 3, autoReadRequested: 1, autoReadSucceeded: 1 },
  }),
  previewEvent(target, {
    id: 'call_crosscheck:search:initial',
    tool: 'web_search',
    stage: 'result',
    status: 'success',
    offset: 8_840,
    parentCallId: 'call_crosscheck',
    query: '公共服务 线上办理 过渡期 原文',
    summary: '并行搜索完成：tavily 命中 3 条',
    hits: CROSS_HITS,
    details: { engine: 'tavily', hitsCount: 3 },
  }),
  previewEvent(target, {
    id: 'call_crosscheck:read:1',
    tool: 'read_url',
    stage: 'result',
    status: 'success',
    offset: 9_600,
    parentCallId: 'call_crosscheck',
    query: CROSS_HITS[0].url,
    summary: '已读取：中国政府网：政策原文索引页',
    details: { url: CROSS_HITS[0].url, title: CROSS_HITS[0].title, wordCount: 741, siteName: '中国政府网' },
  }),
  previewEvent(target, {
    id: 'call_write_summary',
    tool: 'workspace_write',
    stage: 'result',
    status: 'success',
    offset: 11_400,
    query: '写要点整理文件',
    summary: '已生成 2 个产物文件（示例）',
    details: {
      taskType: 'workspace_write',
      argumentsText: JSON.stringify({ path: '今日中国新闻要点整理.md', keepSources: true }),
      resultJson: { files: 2, bytes: 12_516 },
    },
    resultText: '写入 2 个文件：要点整理 Markdown 与来源清单 JSON。',
  }),
]

const meta = previewMeta({
  stableKey: 'preview-completed-184',
  artifacts: createDevArtifacts(184),
})

const commands: NonNullable<ProcessWorkspaceEntryProps['commands']> = {
  onRegenerate: async () => ({ accepted: true, fixture: 'dev-regenerate' }),
}

export const completedCase: ProcessWorkspaceEntryProps = {
  meta,
  reasoningRaw: DEV_REASONING,
  toolEvents: events,
  content: DEV_ANSWER,
  artifacts: meta.artifacts,
  coverage: {
    trace: { status: 'unknown' },
    persisted: { status: 'complete', asOf: at(12_000) },
    projection: { status: 'complete' },
  },
  runTerminal: { finalAnswerGenerated: true },
  commands,
}
