/**
 * web_search 给模型看的呈现层：摘要正文、命中瘦身与任务/证据瘦身。
 *
 * 与判定逻辑分开：这里只负责措辞与截断，不决定检索成败；
 * 结论由 retrievalOutcome 表达，机器读字段见 web-search-outcome.ts。
 */

import { truncateText } from '../../../utils/parsers'
import { formatHitsForModel, type WebSearchHit } from '../../../utils/web-search'
import type { AutoReadItem } from './web-search-auto-read'
import type { RetrievalOutcome } from './web-search-outcome'

export const DEFAULT_MODEL_EVIDENCE_CHARS = 2200
export const DEFAULT_MODEL_RESULT_HITS = 5
export const DEFAULT_MODEL_TASK_RESULTS = 6
export const DEFAULT_MODEL_SNIPPET_CHARS = 360
export const DEFAULT_MODEL_SUMMARY_CHARS = 3200
// 与自动阅读的候选上限一致：模型最多看到 4 条阅读证据，不额外隐藏失败项
export const DEFAULT_MODEL_EVIDENCE_ITEMS = 4
export const DEFAULT_MODEL_EVIDENCE_ITEM_CHARS = 900
export const MAX_MODEL_EVIDENCE_IMAGES = 4

export const buildSummaryForModel = (input: {
  query: string
  hits: WebSearchHit[]
  autoReadEvidence: AutoReadItem[]
  outcome: RetrievalOutcome
}): string => {
  const { query, hits, autoReadEvidence, outcome } = input
  // 结论优先：全失败 / 取消不能被读成「搜索没有结果」
  if (outcome.status === 'cancelled') {
    return `本次检索已取消（${query}）：不再发起新的搜索或网页读取。`
  }
  if (outcome.status === 'failed' || outcome.status === 'timeout') {
    const engineText = outcome.engines
      .map((item) => `${item.engine}:${item.failureKind || item.state}`)
      .join(', ')
    return `检索失败：${query}。全部搜索来源未交付结果${engineText ? `（${engineText}）` : ''}。`
  }
  const base = hits.length === 0 && outcome.restriction.restricted
    ? `限定来源检索：${query}。在 ${outcome.restriction.effective.join(', ') || '指定来源'} 内没有找到结果。`
    : formatHitsForModel(query, hits)
  const timeRangeNote = outcome.timeRange
    ? `\n时间窗核验：${outcome.timeRange.start || '…'} ~ ${outcome.timeRange.end || '…'}，已核实 ${outcome.timeRange.verified} 条，未标日期 ${outcome.timeRange.undated} 条（未核实，不能当作已确认在窗口内）。`
    : ''
  if (autoReadEvidence.length === 0) {
    return `${base}${timeRangeNote}\n\n注：本轮未读取网页正文，仅基于搜索摘要。`
  }

  const bodyItems = autoReadEvidence.filter(
    (item) => item.evidenceKind === 'article' || item.evidenceKind === 'structured',
  )
  const summaryItems = autoReadEvidence.filter((item) => item.evidenceKind === 'summary')
  const failedItems = autoReadEvidence.filter((item) => item.evidenceKind === 'none')
  const lines: string[] = []

  lines.push('自动网页读取证据（按搜索结果顺序）：')
  if (autoReadEvidence.some((item) => item.images?.length)) {
    lines.push('各条目下的图片证据是该网页对应的候选图，不是用户上传；仅凭链接不能确认是正文配图。')
  }
  for (const item of autoReadEvidence) {
    if (item.evidenceKind === 'none') {
      const status = `${item.errorCode || 'UNKNOWN'}${typeof item.httpStatus === 'number' ? ` (HTTP ${item.httpStatus})` : ''}`
      lines.push(`${item.rank}. 读取失败：${item.url} | ${status}，无可用回退正文`)
      continue
    }
    if (item.evidenceKind === 'summary') {
      const sourceSuffix = item.contentSource ? ` | 来源: ${item.contentSource}` : ''
      const failSuffix = item.errorCode ? ` | 原文读取失败: ${item.errorCode}` : ''
      lines.push(`${item.rank}. 仅取得摘要（不计为正文）：${item.url}${sourceSuffix}${failSuffix}`)
      if (item.content) {
        lines.push(`   摘要：${truncateText(item.content, 600)}`)
      }
      if (item.images?.length) {
        lines.push(`   图片证据: ${item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES).map((img) => img.url).join(' | ')}`)
      }
      continue
    }
    const title = item.title || item.url
    const kindSuffix = item.evidenceKind === 'structured' ? '（结构化内容）' : ''
    const extractionSuffix = item.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''
    const reuseSuffix =
      item.fallbackUsed === 'search_content'
        ? `（搜索正文复用${item.contentSource ? ` · ${item.contentSource}` : ''}）`
        : ''
    const truncationSuffix = item.truncated
      ? item.fallbackUsed === 'search_content'
        ? '（提供方正文本已截断，非完整正文）'
        : '（正文已截断，非完整正文）'
      : ''
    lines.push(`${item.rank}. ${title}${kindSuffix}${extractionSuffix}${reuseSuffix}${truncationSuffix}`)
    lines.push(`   URL: ${item.url}`)
    if (item.excerpt) {
      lines.push(`   摘要: ${truncateText(item.excerpt, 360)}`)
    }
    if (item.content) {
      lines.push(`   正文摘录: ${truncateText(item.content, DEFAULT_MODEL_EVIDENCE_CHARS)}`)
    }
    if (item.images?.length) {
      lines.push(`   图片证据: ${item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES).map((img) => img.url).join(' | ')}`)
    }
  }

  return `${base}\n\n${lines.join('\n')}\n\n统计：有效正文 ${bodyItems.length} 条，仅摘要 ${summaryItems.length} 条，失败 ${failedItems.length} 条。${timeRangeNote}`
}

/**
 * 给模型的命中必须保留日期与 provenance：发布日期取引擎声明字段，
 * 缺失就是缺失（JSON 序列化后省略），不能用摘要日期顶替。
 */
export const slimHitsForModel = (hits: WebSearchHit[]) =>
  hits.slice(0, DEFAULT_MODEL_RESULT_HITS).map((hit) => ({
    title: hit.title,
    url: hit.url,
    snippet: truncateText(hit.snippet || hit.content || '', DEFAULT_MODEL_SNIPPET_CHARS),
    imageUrl: hit.imageUrl,
    thumbnailUrl: hit.thumbnailUrl,
    engine: hit.engine,
    rank: hit.rank,
    sourceEngines: Array.isArray(hit.sourceEngines) ? hit.sourceEngines.slice(0, 3) : undefined,
    publishedDate: hit.publishedDate,
    siteName: hit.siteName,
    contentKind: hit.contentKind,
    contentSource: hit.contentSource,
    truncated: hit.contentMetadata?.truncated,
    timeRangeStatus: hit.timeRangeStatus,
  }))

export const slimTaskResultsForModel = (tasks: Array<{ task: { engine: string; query: string; queryLanguage: string }; status: 'success' | 'error'; hits: unknown[]; error?: string }>) =>
  tasks.slice(0, DEFAULT_MODEL_TASK_RESULTS).map((item) => ({
    engine: item.task.engine,
    query: item.task.query,
    queryLanguage: item.task.queryLanguage,
    status: item.status,
    hitsCount: Array.isArray(item.hits) ? item.hits.length : 0,
    error: item.error,
  }))

export const slimEvidenceForModel = (items: AutoReadItem[]) =>
  items.slice(0, DEFAULT_MODEL_EVIDENCE_ITEMS).map((item) => ({
    url: item.url,
    title: item.title,
    evidenceKind: item.evidenceKind,
    contentSource: item.contentSource,
    excerpt: item.excerpt ? truncateText(item.excerpt, DEFAULT_MODEL_SNIPPET_CHARS) : undefined,
    content: item.content ? truncateText(item.content, DEFAULT_MODEL_EVIDENCE_ITEM_CHARS) : undefined,
    images: Array.isArray(item.images) ? item.images.slice(0, MAX_MODEL_EVIDENCE_IMAGES) : undefined,
    siteName: item.siteName,
    byline: item.byline,
    wordCount: item.wordCount,
    publishedDate: item.publishedDate,
    truncated: item.truncated,
    fetchedAt: item.fetchedAt,
    archivedAt: item.archivedAt,
    error: item.error,
    errorCode: item.errorCode,
    httpStatus: item.httpStatus,
    fallbackUsed: item.fallbackUsed,
    skippedReason: item.skippedReason,
    rank: item.rank,
  }))
