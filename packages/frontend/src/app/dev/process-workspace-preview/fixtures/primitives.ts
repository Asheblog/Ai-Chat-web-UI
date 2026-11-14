/**
 * dev 验收页的基础夹具：时间、事件工厂、示例产物与长中文正文。
 *
 * 这里只造"能被真实 Entry / 台账消费的数据形状"。任何数字都必须是夹具自己写下的，
 * 不通过相减或成功率反推；页面顶部的来源横幅负责说明哪些是示例、哪些是导出事实。
 */
import type {
  MessageMeta,
  ToolEvent,
  WebSearchHit,
  WorkspaceArtifact,
} from '@/types'
import type {
  ToolCallPhase,
  ToolCallSource,
  ToolCallStatus,
  ToolEventDetails,
  ToolEventStage,
  ToolInterventionState,
} from '@aichat/shared/chat-stream-contract'

/** 与 trace97 导出同一时间基准，方便把三个口径并排看。 */
export const PREVIEW_BASE_TIME = Date.parse('2026-11-14T11:11:56.126Z')

/** 夹具内相对时间：毫秒偏移 → 绝对时间戳。 */
export const at = (offsetMs: number): number => PREVIEW_BASE_TIME + offsetMs

export interface PreviewTarget {
  sessionId: number
  messageId: number | string
}

export interface PreviewMetaInit {
  stableKey: string
  sessionId?: number
  id?: number | string
  createdAt?: string
  reasoningStatus?: MessageMeta['reasoningStatus']
  reasoningDurationSeconds?: number | null
  streamStatus?: MessageMeta['streamStatus']
  stopReason?: MessageMeta['stopReason']
  finalAnswerGenerated?: boolean
  artifacts?: WorkspaceArtifact[]
  clientMessageId?: string | null
}

export const previewMeta = (init: PreviewMetaInit): MessageMeta => ({
  id: init.id ?? 184,
  sessionId: init.sessionId ?? 12,
  stableKey: init.stableKey,
  role: 'assistant',
  createdAt: init.createdAt ?? new Date(PREVIEW_BASE_TIME).toISOString(),
  clientMessageId: init.clientMessageId ?? null,
  reasoningStatus: init.reasoningStatus ?? 'done',
  reasoningDurationSeconds:
    init.reasoningDurationSeconds === undefined ? 236 : init.reasoningDurationSeconds,
  streamStatus: init.streamStatus ?? 'done',
  // 公共字段是 undefined 缺省，不是 null：显式写 null 会被读成"已知无值"
  stopReason: init.stopReason ?? undefined,
  finalAnswerGenerated: init.finalAnswerGenerated ?? true,
  artifacts: init.artifacts,
})

export interface PreviewEventInit {
  id: string
  tool: string
  stage: ToolEventStage
  status: ToolCallStatus
  offset: number
  callId?: string
  /** 写入 details.parentCallId：台账父子关系只认这个字段 */
  parentCallId?: string
  query?: string
  summary?: string
  error?: string
  hits?: WebSearchHit[]
  details?: ToolEventDetails
  intervention?: ToolInterventionState
  phase?: ToolCallPhase
  source?: ToolCallSource
  identifier?: string
  resultText?: string
  updatedOffset?: number
}

export const previewEvent = (target: PreviewTarget, init: PreviewEventInit): ToolEvent => {
  const details: ToolEventDetails | undefined =
    init.parentCallId || init.details
      ? { ...(init.details ?? {}), ...(init.parentCallId ? { parentCallId: init.parentCallId } : {}) }
      : undefined
  return {
    id: init.id,
    sessionId: target.sessionId,
    messageId: target.messageId,
    tool: init.tool,
    stage: init.stage,
    status: init.status,
    query: init.query,
    hits: init.hits,
    error: init.error,
    summary: init.summary,
    createdAt: at(init.offset),
    updatedAt: at(init.updatedOffset ?? init.offset + 40),
    details,
    callId: init.callId ?? init.id,
    identifier: init.identifier,
    source: init.source ?? 'builtin',
    phase: init.phase,
    intervention: init.intervention,
    resultText: init.resultText,
  }
}

/** dev 下载用示例文件：由 app/dev/.../artifacts/[file]/route.ts 真实返回字节。 */
export const DEV_ARTIFACT_FILES = [
  {
    slug: 'news-summary.md',
    fileName: '今日中国新闻要点整理·按政策、经济与社会分类（2026-11-14 示例）.md',
    mimeType: 'text/markdown',
    sizeBytes: 4_312,
  },
  {
    slug: 'sources.json',
    fileName: 'sources-18-hits-12-unique.json',
    mimeType: 'application/json',
    sizeBytes: 8_204,
  },
] as const

export type DevArtifactSlug = (typeof DEV_ARTIFACT_FILES)[number]['slug']

export const DEV_ARTIFACT_BASE = '/dev/process-workspace-preview/artifacts'

export const devArtifactUrl = (slug: DevArtifactSlug): string => `${DEV_ARTIFACT_BASE}/${slug}`

export const createDevArtifacts = (messageId: number | string): WorkspaceArtifact[] =>
  DEV_ARTIFACT_FILES.map((file, position) => ({
    id: 9_001 + position,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    expiresAt: new Date(at(86_400_000)).toISOString(),
    downloadUrl: devArtifactUrl(file.slug),
    messageId: typeof messageId === 'number' ? messageId : null,
  }))

/** 可见推理原文（不是工具记录）：长中文，含取舍说明，用于验证推理与台账分层。 */
export const DEV_REASONING = [
  '用户要的是今天值得关注的中国新闻，不是新闻列表搬运。先把范围限定为今天、境内可核实的公开报道，再按政策、经济、社会三条线整理。',
  '搜索这一步有两个风险：一是不同引擎对"今天"的时间窗理解不同，二是自动读取正文可能失败。所以先并行跑中英两路搜索，命中数只作参考，不当作事实。',
  '读取正文时优先拿原文标题、发布时间和发布机构；读不到正文的条目退回搜索摘要，并在过程里标成降级，绝不把摘要写成"已读原文"。',
  '最后整理成三条主线，每条只写发布背景、主要变化和对普通人的影响，引用按来源编号挂回正文，避免在答案里堆链接。',
].join('\n\n')

const LONG_TOKEN = 'https://www.gov.cn/zhengce/zhengceku/2026-11/14/content_9f2c1b7ad4e34c0f8f3a5c6b7de8a912.html'

/** 完成态长中文正文：含小标题、编号、引用角标、超长链接与长句，检查换行与溢出。 */
export const DEV_ANSWER = [
  '## 今天值得关注的中国新闻',
  '',
  '按政策、经济、社会三条线整理，优先对照发布机构原文；交互演示数据·非实时新闻。',
  '',
  '### 01 政策与民生',
  '',
  '**政策发布与公共服务安排**',
  '',
  '发布背景、主要变化与影响对象放在一起读，先看要点：一是面向城镇居民的公共服务事项在本周集中调整，二是相关办理渠道同步迁移到线上，三是过渡期内原有窗口仍然保留，避免出现"线上没通、线下已关"的空档［1］。',
  '',
  '### 02 经济与产业',
  '',
  '**经济数据与产业动态**',
  '',
  '区分已发布数据、机构解读与后续观察，呈现关键影响。需要说明的是，同比与环比口径不同，两个数字不能直接比较；涉及地区差异的部分，原文只给出了样本说明，没有给出全省口径，这里不做外推。',
  '',
  '### 03 政策与公共服务',
  '',
  '**科研政策与公共服务**',
  '',
  '依据政策原文，区分发布事项与后续安排。原文在附件里给出了完整办理清单，其中一条要求提交纸质材料的条款，与前面"全程线上"的说法存在出入，已在过程记录里标注为待核对，未在本段断言。',
  '',
  '### 引用与核对说明',
  '',
  '正文引用按来源编号挂回右侧"来源"页签，同一来源在多处出现只保留一个条目；读取失败退回摘要的条目在调用台账里标为降级，不在答案里当作原文引用。',
  '',
  '原始政策原文地址：' + LONG_TOKEN,
  '',
  '### 阅读建议',
  '',
  '如果只关心与自己相关的部分，可以先看第三条；如果要对外转述，建议以引用编号回到原文核对时间与机构名称，因为部分稿件在转载时会改动标题而保留原文时间，容易造成"旧闻新发"的误判。',
  '',
  '### 附：本次整理的取舍',
  '',
  '同一事件在不同渠道往往有多条稿件，这里只保留发布机构最早的一条，其余用于交叉核对，不重复引用。涉及数字的段落一律写出处与口径；原文只给出抽样说明的部分，宁可不写结论，也不做外推。若你需要把这些要点直接用于对外发布，建议再人工核对一遍附件清单与生效日期，因为这两项在转载过程中最容易出现偏差。',
].join('\n')

/** 失败/降级态正文：明确写出影响，不把错误写成成功。 */
export const DEV_DEGRADED_ANSWER = [
  '## 今天值得关注的中国新闻（部分来源未取到原文）',
  '',
  '按政策、经济、社会三条线整理。本轮有 1 条正文读取失败并退回搜索摘要，另有 1 次写入未获许可，因此下面两条只给结论与出处，不引原文段落。',
  '',
  '### 01 政策与民生',
  '',
  '公共服务事项本周集中调整，办理渠道同步迁移到线上，过渡期保留线下窗口。这条依据的是搜索摘要与页面标题，正文未取到，引用标记为"摘要"。',
  '',
  '### 02 经济与产业',
  '',
  '机构解读与已发布数据要分开看。涉及地区样本的结论，原文只给出抽样说明，因此这里不做全省口径推断。',
  '',
  '### 03 未完成的部分',
  '',
  '整理成文件的步骤未获许可，所以本轮没有生成新的产物文件；如需该文件，请授予写入权限后重新生成本轮回答。',
].join('\n')

/** 运行态正文：只写已经确认的部分，明确还在进行中的动作。 */
export const DEV_RUNNING_ANSWER = [
  '正在整理今天值得关注的中国新闻，先把已核实的结论放在前面。',
  '',
  '### 已确认',
  '',
  '- 政策与民生：公共服务事项本周集中调整，办理渠道迁移到线上。',
  '- 经济与产业：数据已发布，机构解读仍在核对口径差异。',
  '',
  '### 进行中',
  '',
  '还有 2 条正文正在读取，其中 1 条已经等待超过 20 秒；如果继续卡在读取上，可以停止后续工具，用已有资料直接作答。',
].join('\n')

/** 审批态正文：等待用户确认研究计划，不假装已经在跑。 */
export const DEV_APPROVAL_ANSWER = [
  '这个问题需要多轮检索才能回答，我先给出研究计划，等你确认范围后再开始执行。',
  '',
  '计划里列出了 3 个子问题和预计的工具轮次；如果某个子问题不在你关心的范围内，可以直接调整后再批准。',
].join('\n')
