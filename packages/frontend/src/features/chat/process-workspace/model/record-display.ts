/**
 * 单条记录与来源的展示投影：标题沿用 shared 的步骤标题，来源只从确证命中/详情里读。
 */
import { buildToolStepTitle, resolveToolDisplay } from '@aichat/shared/cot-timeline'
import type { ProcessIndex, ProcessRecord } from './operation-index'

/* ── 来源 ───────────────────────────────────────────────────── */

export interface ProcessSource {
  /** 来源清单顺序号（1 起，按首次出现去重后编号）。它不是生产者的 citation id，
   *  正文里的引用编号由内容生产方决定，这里不做对齐，也不代表"第 N 条引用"。 */
  order: number
  url: string
  title: string
  siteName?: string
  /** 出现来源的工具标签（去重后） */
  tools: string[]
  /** 记录自带的主图（details.leadImageUrl），没有就不显示 */
  leadImageUrl?: string
  /** 记录自带的图片数（details.images.length），只在有图时给出 */
  imageCount?: number
}

const normalizeUrl = (url: string): string => {
  const trimmed = url.trim()
  try {
    const parsed = new URL(trimmed)
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return trimmed
  }
}

/**
 * 来源去重：同一 url 只留一条，标题取首个已知值，工具标签与主图合并。
 * 只从命中与记录详情里读已知信息；没有 url 的记录不产生来源。
 * 输出顺序 = 首次出现顺序；order 只是清单编号，不是正文 citation id。
 */
export const collectProcessSources = (index: ProcessIndex): ProcessSource[] => {
  const byUrl = new Map<string, ProcessSource>()
  const seen: string[] = []

  const add = (
    url: string,
    title: string | undefined,
    siteName: string | undefined,
    tool: string,
    images?: { leadImageUrl?: string; imageCount?: number },
  ) => {
    if (!url || !url.trim()) return
    const key = normalizeUrl(url)
    const existing = byUrl.get(key)
    if (existing) {
      if (!existing.tools.includes(tool)) existing.tools.push(tool)
      if (!existing.leadImageUrl && images?.leadImageUrl) existing.leadImageUrl = images.leadImageUrl
      if (existing.imageCount === undefined && images?.imageCount !== undefined) existing.imageCount = images.imageCount
      return
    }
    byUrl.set(key, {
      order: seen.length + 1,
      url: key,
      title: title?.trim() || key,
      siteName: siteName?.trim() || undefined,
      tools: [tool],
      leadImageUrl: images?.leadImageUrl,
      imageCount: images?.imageCount,
    })
    seen.push(key)
  }

  for (const record of index.records) {
    const toolLabel = resolveToolDisplay(record.identifier ?? record.tool).label
    for (const hit of record.event.hits ?? []) {
      add(hit.url, hit.title, undefined, toolLabel)
    }
    const details = record.event.details
    if (details && typeof details.url === 'string') {
      const leadImageUrl = typeof details.leadImageUrl === 'string' ? details.leadImageUrl : undefined
      const imageCount = Array.isArray(details.images) ? details.images.length : undefined
      add(details.url, details.title, details.siteName, toolLabel, { leadImageUrl, imageCount })
    }
  }

  return seen.map((key) => byUrl.get(key)!).filter(Boolean)
}

/* ── 展示文案 ───────────────────────────────────────────────── */

export interface ProcessRecordLabel {
  title: string
  toolLabel: string
}

/** 单条记录的标题沿用 shared 的步骤标题（与旧时间轴同名同义）。 */
export const describeProcessRecord = (record: ProcessRecord): ProcessRecordLabel => ({
  title: buildToolStepTitle(record.event),
  toolLabel: resolveToolDisplay(record.identifier ?? record.tool).label,
})

/** 流式当前活动：只取真实处于 in_flight 的最后一条；没有就返回 null。 */
export const resolveProcessActivity = (index: ProcessIndex): string | null => {
  for (let i = index.records.length - 1; i >= 0; i -= 1) {
    const record = index.records[i]
    if (record.outcome === 'in_flight') {
      const pending = record.status === 'pending'
      return `${pending ? '等待确认 · ' : '正在执行 · '}${describeProcessRecord(record).title}`
    }
  }
  return null
}