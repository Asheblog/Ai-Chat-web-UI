/**
 * 搜索后的自动阅读批次调度。
 *
 * 职责边界（纯调度，不接触网络与浏览器）：
 * - 一个批次共享一条总 deadline，覆盖排队、替补与全部 URL；
 * - 单 URL 超时由调用方传入，语义与 autoReadTimeoutMs 一致；
 * - 只复用 article 种类的搜索正文，摘要 / 片段只能作为摘要证据；
 * - 候选失败时在剩余时间内换下一个高相关结果，不整轮重搜；
 * - 同一批次内同一 URL 只读一次。
 *
 * 读取实现由调用方注入（read），因此可以在真实 handler 里接 url-reader，在测试里接 mock 传输。
 */

import { WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS } from '@aichat/shared'
import { combineAbortSignals } from '../../../utils/abort-signal'
import { truncateText } from '../../../utils/parsers'
import { normalizeSearchUrl, type WebSearchContentKind } from '../../../utils/web-search'
import type {
  UrlReadAttempt,
  UrlReadContentKind,
  UrlReadErrorCode,
} from '../../../utils/url-reader'

/** 默认值来自配置边界定义，settings / handler / 调度器共用同一组常量。 */
export const DEFAULT_AUTO_READ_BATCH_TIMEOUT_MS = WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS.fallback
export const DEFAULT_AUTO_READ_EVIDENCE_TARGET = 2
export const DEFAULT_AUTO_READ_MAX_CANDIDATES = 4
export const DEFAULT_AUTO_READ_PARALLELISM = 2
export const DEFAULT_AUTO_READ_MAX_CONTENT_CHARS = 24000
export const DEFAULT_AUTO_READ_EXCERPT_CHARS = 360

/**
 * 调度器内部下限，只用于单元测试把 deadline 缩到毫秒级。
 * 生产可配置下界是 WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS.min（3000），handler 与 settings 层按它校验。
 */
const SCHEDULER_MIN_BATCH_DEADLINE_MS = 100

/** 一条自动阅读结果作为证据的种类。article / structured 是有效正文，summary 只是摘要。 */
export type AutoReadEvidenceKind = 'article' | 'structured' | 'summary' | 'none'

export type AutoReadFallbackUsed =
  | 'none'
  | 'search_content'
  | 'search_snippet'
  | 'crawler'
  | 'browser'
  | 'deepseek_fetch'
  | 'document'
  | 'wayback'
  | 'python'
  | 'provided'

export type AutoReadSkippedReason =
  | 'batch_deadline'
  | 'evidence_target_met'
  | 'candidate_budget'
  | 'cancelled'

/** 读取器声明的正文种类，直接沿用 core 的 UrlReadContentKind，避免两套枚举漂移。 */
export type AutoReadReadContentKind = UrlReadContentKind

export interface AutoReadSearchContent {
  content: string
  kind: WebSearchContentKind
  source: string
  /** 提供方对正文长度设了硬上限并已截断，复用时要如实标记，不能当完整正文。 */
  truncated?: boolean
  /** 提供方声明的抓取时间；提供方不给就保持 undefined，不伪造。 */
  fetchedAt?: string
}

export interface AutoReadCandidate {
  url: string
  title?: string
  /** 命中来自哪个搜索提供方，摘要回退时作为内容来源记录。 */
  engine?: string
  snippet?: string
  searchContent?: AutoReadSearchContent
}

export interface AutoReadReadRequest {
  url: string
  /** 本次读取可用的时间预算：单 URL 上限与批次剩余时间取较小值。 */
  timeoutMs: number
  signal: AbortSignal
}

export interface AutoReadReadResult {
  title?: string
  textContent?: string
  excerpt?: string
  siteName?: string
  byline?: string
  wordCount?: number
  leadImageUrl?: string
  images?: Array<{ url: string }>
  fallbackUsed?: AutoReadFallbackUsed
  engine?: string
  attempts?: UrlReadAttempt[]
  finalUrl?: string
  rendered?: boolean
  contentFormat?: string
  contentKind?: AutoReadReadContentKind
  fetchedAt?: string
  archivedAt?: string
  truncated?: boolean
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
}

export interface AutoReadItem {
  url: string
  title?: string
  /** 在候选列表中的顺位（1 开始）。 */
  rank: number
  evidenceKind: AutoReadEvidenceKind
  content?: string
  excerpt?: string
  siteName?: string
  byline?: string
  wordCount?: number
  images?: Array<{ url: string }>
  leadImageUrl?: string
  /** 实际提供 content 的一方：搜索提供方名或读取引擎名。 */
  contentSource?: string
  fallbackUsed: AutoReadFallbackUsed
  attempts?: UrlReadAttempt[]
  finalUrl?: string
  rendered?: boolean
  contentFormat?: string
  fetchedAt?: string
  archivedAt?: string
  truncated?: boolean
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  skippedReason?: AutoReadSkippedReason
}

export type AutoReadEvent =
  | { stage: 'start'; url: string; rank: number; timeoutMs: number }
  | {
      stage: 'result'
      url: string
      rank: number
      evidenceKind: AutoReadEvidenceKind
      contentSource?: string
      fallbackUsed: AutoReadFallbackUsed
    }
  | {
      stage: 'error'
      url: string
      rank: number
      error: string
      errorCode?: UrlReadErrorCode
      fallbackUsed: AutoReadFallbackUsed
    }
  | { stage: 'skip'; url: string; rank: number; reason: AutoReadSkippedReason }

export interface AutoReadBatchOptions {
  candidates: AutoReadCandidate[]
  read: (request: AutoReadReadRequest) => Promise<AutoReadReadResult>
  /** 单 URL 超时（autoReadTimeoutMs 语义）。 */
  perUrlTimeoutMs: number
  /** 整批总时限，默认 18s；与单 URL 超时分别存储。生产下界由调用方按配置边界校验。 */
  batchTimeoutMs?: number
  /** 需要取得几条有效正文证据，默认 2。 */
  evidenceTarget?: number
  /** 最多检查几个候选，默认 4。 */
  maxCandidates?: number
  /** 并发读取数，默认 2。浏览器自身的并发上限由读取器控制。 */
  parallelism?: number
  maxContentChars?: number
  signal?: AbortSignal
  onEvent?: (event: AutoReadEvent) => void
  /** 测试可注入的时钟，默认 Date.now。 */
  now?: () => number
}

export interface AutoReadBatchResult {
  items: AutoReadItem[]
  articleCount: number
  structuredCount: number
  summaryCount: number
  failedCount: number
  /** 实际发起过读取或被复用的候选数。 */
  candidatesExamined: number
  /** 去重并截断后计划检查的候选数。 */
  candidateCount: number
  duplicateUrls: string[]
  deadlineExceeded: boolean
  cancelled: boolean
  batchTimeoutMs: number
  batchElapsedMs: number
}

const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const READ_CONTENT_KIND_TO_EVIDENCE: Record<AutoReadReadContentKind, AutoReadEvidenceKind> = {
  article: 'article',
  structured: 'structured',
  summary: 'summary',
  none: 'none',
}

/** 本地长度裁剪：与提供方/读取器自带的截断标记一起决定 truncated，不能静默切掉正文。 */
const sliceContent = (text: string, maxChars: number): { content: string; truncated: boolean } => {
  const normalized = (text || '').trim()
  if (!normalized) return { content: '', truncated: false }
  if (normalized.length <= maxChars) return { content: normalized, truncated: false }
  return { content: truncateText(normalized, maxChars), truncated: true }
}

const isArticleSearchContent = (content?: AutoReadSearchContent): content is AutoReadSearchContent =>
  Boolean(content && content.kind === 'article' && content.content.trim().length > 0)

const normalizeCandidateKey = (url: string): string => {
  const trimmed = (url || '').trim()
  if (!trimmed) return ''
  return normalizeSearchUrl(trimmed) || trimmed
}

export const runSearchAutoReadBatch = async (
  options: AutoReadBatchOptions,
): Promise<AutoReadBatchResult> => {
  const now = options.now || Date.now
  const evidenceTarget = clampInt(options.evidenceTarget, DEFAULT_AUTO_READ_EVIDENCE_TARGET, 1, 10)
  const maxCandidates = clampInt(options.maxCandidates, DEFAULT_AUTO_READ_MAX_CANDIDATES, 1, 10)
  const parallelism = clampInt(options.parallelism, DEFAULT_AUTO_READ_PARALLELISM, 1, 4)
  const batchTimeoutMs = clampInt(
    options.batchTimeoutMs,
    DEFAULT_AUTO_READ_BATCH_TIMEOUT_MS,
    SCHEDULER_MIN_BATCH_DEADLINE_MS,
    WEB_SEARCH_AUTO_READ_BATCH_TIMEOUT_MS.max,
  )
  const maxContentChars = clampInt(options.maxContentChars, DEFAULT_AUTO_READ_MAX_CONTENT_CHARS, 200, 400000)
  const perUrlTimeoutMs = Math.max(1, Math.floor(options.perUrlTimeoutMs || 1))

  const startedAt = now()
  const deadlineAt = startedAt + batchTimeoutMs
  const remainingMs = () => Math.max(0, deadlineAt - now())
  const requestCancelled = () => Boolean(options.signal?.aborted)

  let deadlineExceeded = false
  const batchController = new AbortController()
  const deadlineTimer = setTimeout(() => {
    deadlineExceeded = true
    batchController.abort(new DOMException('Auto-read batch deadline exceeded', 'TimeoutError'))
  }, batchTimeoutMs)
  const combined = combineAbortSignals(batchController.signal, options.signal)

  // 同一批次内同一 URL 只读一次；去掉跟踪参数但保留有语义的 query
  const seenUrls = new Set<string>()
  const duplicateUrls: string[] = []
  const queue: AutoReadCandidate[] = []
  for (const candidate of options.candidates) {
    const key = normalizeCandidateKey(candidate.url)
    if (!key) continue
    if (seenUrls.has(key)) {
      duplicateUrls.push(candidate.url)
      continue
    }
    seenUrls.add(key)
    if (queue.length >= maxCandidates) continue
    queue.push(candidate)
  }

  const emit = (event: AutoReadEvent) => {
    try {
      options.onEvent?.(event)
    } catch {
      // 观测回调失败不能打断读取批次
    }
  }

  const skipReasonOf = (): AutoReadSkippedReason => {
    if (requestCancelled()) return 'cancelled'
    if (deadlineExceeded || combined.signal.aborted) return 'batch_deadline'
    return 'candidate_budget'
  }

  const buildSkipItem = (
    candidate: AutoReadCandidate,
    rank: number,
    reason: AutoReadSkippedReason,
  ): AutoReadItem => {
    const cancelled = reason === 'cancelled'
    const timedOut = reason === 'batch_deadline'
    return {
      url: candidate.url,
      title: candidate.title,
      rank,
      evidenceKind: 'none',
      fallbackUsed: 'none',
      skippedReason: reason,
      ...(cancelled
        ? { error: '请求已取消，未开始读取', errorCode: 'CANCELLED' as UrlReadErrorCode }
        : timedOut
          ? {
              error: `批次总时限 ${batchTimeoutMs}ms 已用完，未开始读取`,
              errorCode: 'TIMEOUT' as UrlReadErrorCode,
            }
          : {}),
    }
  }

  const items: Array<AutoReadItem | undefined> = new Array(queue.length)
  let articleCount = 0
  let structuredCount = 0
  let summaryCount = 0
  let failedCount = 0
  let candidatesExamined = 0
  let nextIndex = 0

  const validEvidenceCount = () => articleCount + structuredCount

  const failureItem = (
    candidate: AutoReadCandidate,
    rank: number,
    result: AutoReadReadResult,
    fallbackError: string,
  ): AutoReadItem => {
    const fallbackSlice = sliceContent(
      candidate.searchContent?.content || candidate.snippet || '',
      maxContentChars,
    )
    const hasFallback = fallbackSlice.content.length > 0
    const error = result.error || fallbackError
    const item: AutoReadItem = {
      url: candidate.url,
      title: result.title || candidate.title,
      rank,
      evidenceKind: hasFallback ? 'summary' : 'none',
      content: hasFallback ? fallbackSlice.content : undefined,
      excerpt: truncateText(candidate.snippet || '', DEFAULT_AUTO_READ_EXCERPT_CHARS) || undefined,
      contentSource: hasFallback
        ? candidate.searchContent?.source || candidate.engine
        : result.engine,
      fallbackUsed: hasFallback ? 'search_snippet' : 'none',
      attempts: result.attempts,
      finalUrl: result.finalUrl,
      rendered: result.rendered,
      contentFormat: result.contentFormat,
      // 读取器的标记优先；失败回退到搜索片段时保留本地裁剪与提供方的截断标记，不伪造时间
      fetchedAt: result.fetchedAt ?? candidate.searchContent?.fetchedAt,
      archivedAt: result.archivedAt,
      truncated:
        result.truncated ||
        (hasFallback && (fallbackSlice.truncated || Boolean(candidate.searchContent?.truncated))) ||
        undefined,
      error,
      errorCode: result.errorCode,
      httpStatus: result.httpStatus,
    }
    emit({
      stage: 'error',
      url: item.url,
      rank,
      error,
      errorCode: item.errorCode,
      fallbackUsed: item.fallbackUsed,
    })
    return item
  }

  const processCandidate = async (
    candidate: AutoReadCandidate,
    rank: number,
  ): Promise<AutoReadItem> => {
    if (isArticleSearchContent(candidate.searchContent)) {
      const reusedSlice = sliceContent(candidate.searchContent.content, maxContentChars)
      const item: AutoReadItem = {
        url: candidate.url,
        title: candidate.title,
        rank,
        evidenceKind: 'article',
        content: reusedSlice.content,
        excerpt: truncateText(candidate.snippet || '', DEFAULT_AUTO_READ_EXCERPT_CHARS) || undefined,
        contentSource: candidate.searchContent.source,
        fallbackUsed: 'search_content',
        // 提供方的截断与时间标记原样透传；本地裁剪同样记为截断，缺失就是缺失
        truncated: reusedSlice.truncated || candidate.searchContent.truncated || undefined,
        fetchedAt: candidate.searchContent.fetchedAt,
      }
      emit({
        stage: 'result',
        url: item.url,
        rank,
        evidenceKind: 'article',
        contentSource: item.contentSource,
        fallbackUsed: 'search_content',
      })
      return item
    }

    if (combined.signal.aborted || remainingMs() <= 0) {
      const item = buildSkipItem(candidate, rank, skipReasonOf())
      emit({ stage: 'skip', url: item.url, rank, reason: item.skippedReason as AutoReadSkippedReason })
      return item
    }

    const timeoutMs = Math.max(1, Math.min(perUrlTimeoutMs, remainingMs()))
    emit({ stage: 'start', url: candidate.url, rank, timeoutMs })

    let result: AutoReadReadResult
    try {
      result = await options.read({ url: candidate.url, timeoutMs, signal: combined.signal })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Auto read failed'
      const errorCode: UrlReadErrorCode = requestCancelled()
        ? 'CANCELLED'
        : combined.signal.aborted
          ? 'TIMEOUT'
          : 'FETCH_FAILED'
      return failureItem(candidate, rank, { error: message, errorCode }, message)
    }

    if (result.error) {
      return failureItem(candidate, rank, result, 'Auto read failed')
    }

    const readSlice = sliceContent(result.textContent || '', maxContentChars)
    const declaredKind = result.contentKind
    const evidenceKind = declaredKind
      ? READ_CONTENT_KIND_TO_EVIDENCE[declaredKind]
      : 'article'
    if (!readSlice.content || evidenceKind === 'none') {
      return failureItem(
        candidate,
        rank,
        { ...result, error: result.error || 'Empty content', errorCode: result.errorCode || 'EMPTY_CONTENT' },
        'Empty content',
      )
    }

    const item: AutoReadItem = {
      url: candidate.url,
      title: result.title || candidate.title,
      rank,
      evidenceKind,
      content: readSlice.content,
      excerpt: result.excerpt || truncateText(readSlice.content, DEFAULT_AUTO_READ_EXCERPT_CHARS),
      siteName: result.siteName,
      byline: result.byline,
      wordCount: result.wordCount,
      images: result.images,
      leadImageUrl: result.leadImageUrl,
      contentSource: result.engine,
      fallbackUsed: result.fallbackUsed || 'none',
      attempts: result.attempts,
      finalUrl: result.finalUrl,
      rendered: result.rendered,
      contentFormat: result.contentFormat,
      fetchedAt: result.fetchedAt,
      archivedAt: result.archivedAt,
      // 本地裁剪或读取器标记任一成立即视为截断
      truncated: readSlice.truncated || result.truncated || undefined,
    }
    emit({
      stage: 'result',
      url: item.url,
      rank,
      evidenceKind,
      contentSource: item.contentSource,
      fallbackUsed: item.fallbackUsed,
    })
    return item
  }

  const worker = async (): Promise<void> => {
    while (true) {
      if (combined.signal.aborted || validEvidenceCount() >= evidenceTarget || nextIndex >= queue.length) {
        return
      }
      const index = nextIndex
      nextIndex += 1
      const item = await processCandidate(queue[index], index + 1)
      items[index] = item
      candidatesExamined += 1
      if (item.evidenceKind === 'article') articleCount += 1
      else if (item.evidenceKind === 'structured') structuredCount += 1
      else if (item.evidenceKind === 'summary') summaryCount += 1
      else failedCount += 1
    }
  }

  try {
    const workerCount = Math.max(1, Math.min(parallelism, queue.length))
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
  } finally {
    clearTimeout(deadlineTimer)
    combined.cleanup()
  }

  for (let index = 0; index < queue.length; index += 1) {
    if (items[index]) continue
    const reason: AutoReadSkippedReason = requestCancelled()
      ? 'cancelled'
      : deadlineExceeded || combined.signal.aborted
        ? 'batch_deadline'
        : validEvidenceCount() >= evidenceTarget
          ? 'evidence_target_met'
          : 'candidate_budget'
    const item = buildSkipItem(queue[index], index + 1, reason)
    items[index] = item
    emit({ stage: 'skip', url: item.url, rank: item.rank, reason })
  }

  return {
    items: items.filter((item): item is AutoReadItem => Boolean(item)),
    articleCount,
    structuredCount,
    summaryCount,
    failedCount,
    candidatesExamined,
    candidateCount: queue.length,
    duplicateUrls,
    deadlineExceeded,
    cancelled: requestCancelled(),
    batchTimeoutMs,
    batchElapsedMs: Math.max(0, now() - startedAt),
  }
}
