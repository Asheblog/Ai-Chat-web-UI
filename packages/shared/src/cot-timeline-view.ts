/**
 * 过程时间轴的三段折叠状态机与一行摘要 —— web / mobile 共用（RN 安全，无 DOM）。
 *
 * 三级：collapsed（整条压成一行）→ outline（每步一行提纲）→ expanded（每步细节全开）。
 * 这里只做数据聚合与级别判定，文案拼装与视觉交给各端，保证两端行为一致。
 */
import { resolveEventStatus, type ToolEvent } from './tool-events.js'
import type { CotTimelineNode } from './cot-timeline.js'

/** 时间轴整条的三段折叠级别 */
export type CotTimelineLevel = 'collapsed' | 'outline' | 'expanded'

export const COT_TIMELINE_LEVELS: readonly CotTimelineLevel[] = [
  'collapsed',
  'outline',
  'expanded',
]

export const isCotTimelineLevel = (value: unknown): value is CotTimelineLevel =>
  typeof value === 'string' && (COT_TIMELINE_LEVELS as readonly string[]).includes(value)

const isActiveStatus = (status: string) => status === 'running' || status === 'pending'
const isFailedStatus = (status: string) =>
  status === 'error' || status === 'rejected' || status === 'aborted'

const resolveToolType = (event: ToolEvent): string =>
  event.identifier || event.apiName || event.tool || ''

const countHits = (event: ToolEvent): number => {
  if (typeof event.details?.hitsCount === 'number') return event.details.hitsCount
  if (Array.isArray(event.hits)) return event.hits.length
  const resultJson = event.resultJson
  if (resultJson && typeof resultJson === 'object' && !Array.isArray(resultJson)) {
    const hits = (resultJson as Record<string, unknown>).hits
    if (Array.isArray(hits)) return hits.length
  }
  return 0
}

const collectToolEvents = (nodes: CotTimelineNode[]): ToolEvent[] => {
  const events: ToolEvent[] = []
  for (const node of nodes) {
    if (node.type === 'tool') events.push(node.event)
    else if (node.type === 'toolGroup') events.push(...node.events)
  }
  return events
}

/** 一行摘要最多带几条细节，避免折叠条本身又变成一堵墙 */
const DETAIL_CHIP_LIMIT = 3

export interface CotTimelineSummary {
  /** 步骤总数（推理段 + 工具 / 工具组） */
  stepCount: number
  reasoningCount: number
  toolCount: number
  /** 搜索次数（web_search 调用数，等价于「几个引擎」） */
  engineCount: number
  hitCount: number
  readCount: number
  failedCount: number
  activeCount: number
  /** 折叠条上的细节片段，按信息量排序并已截断 */
  detailChips: string[]
  /** 无障碍朗读用的短句（不含「点击展开」这类动作提示，由调用方补） */
  ariaLabel: string
}

/**
 * 把节点流压成一行摘要用的统计。
 * 只依赖 nodes，不读 meta，方便流式过程中反复调用。
 */
export const buildCotTimelineSummary = (nodes: CotTimelineNode[]): CotTimelineSummary => {
  const events = collectToolEvents(nodes)
  let reasoningCount = 0
  for (const node of nodes) {
    if (node.type === 'reasoning') reasoningCount += 1
  }

  let engineCount = 0
  let hitCount = 0
  let readCount = 0
  let failedCount = 0
  let activeCount = 0

  for (const event of events) {
    const toolType = resolveToolType(event)
    const status = resolveEventStatus(event)
    if (toolType === 'web_search') {
      engineCount += 1
      hitCount += countHits(event)
    }
    if (toolType === 'read_url') readCount += 1
    if (isFailedStatus(status)) failedCount += 1
    if (isActiveStatus(status)) activeCount += 1
  }

  const detailChips: string[] = []
  if (activeCount > 0) detailChips.push(`执行中 ${activeCount}`)
  if (engineCount > 0) detailChips.push(`搜索 ${engineCount} 次`)
  if (hitCount > 0) detailChips.push(`命中 ${hitCount} 条`)
  if (readCount > 0) detailChips.push(`读取 ${readCount} 篇`)
  if (failedCount > 0) detailChips.push(`${failedCount} 次失败`)

  const ariaParts = [`过程时间轴，共 ${nodes.length} 步`]
  if (reasoningCount > 0) ariaParts.push(`思考 ${reasoningCount} 段`)
  if (events.length > 0) ariaParts.push(`工具调用 ${events.length} 次`)
  if (failedCount > 0) ariaParts.push(`${failedCount} 次失败`)

  return {
    stepCount: nodes.length,
    reasoningCount,
    toolCount: events.length,
    engineCount,
    hitCount,
    readCount,
    failedCount,
    activeCount,
    detailChips: detailChips.slice(0, DETAIL_CHIP_LIMIT),
    ariaLabel: ariaParts.join('，'),
  }
}

export interface CotTimelineLevelInput {
  /** 用户手动选择的级别，优先级最高 */
  preference?: CotTimelineLevel | null
  /** 调用方给的默认级别（如 Battle 详情传 expanded） */
  defaultLevel?: CotTimelineLevel | null
  /** 当前消息是否仍在流式作答 */
  isStreaming?: boolean
}

/**
 * 三段折叠的最终级别：用户手选 > 调用方默认 > 流式（提纲） > 完成态（一行）。
 * 流式期间落 outline，用户能看见正在想什么、搜什么；一旦完成且用户没手动改过，自动收成一行。
 */
export const resolveCotTimelineLevel = ({
  preference = null,
  defaultLevel = null,
  isStreaming = false,
}: CotTimelineLevelInput = {}): CotTimelineLevel => {
  if (preference) return preference
  if (defaultLevel) return defaultLevel
  return isStreaming ? 'outline' : 'collapsed'
}

/** 头部主开关只在 collapsed 与 outline 之间翻转（expanded 交给「全部展开 / 全部折叠」） */
export const toggleCotTimelineLevel = (level: CotTimelineLevel): CotTimelineLevel =>
  level === 'collapsed' ? 'outline' : 'collapsed'
