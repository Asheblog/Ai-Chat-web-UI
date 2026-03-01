/**
 * Web 搜索工具处理器
 */

import { randomUUID } from 'node:crypto'
import { runWebSearch, formatHitsForModel } from '../../../utils/web-search'
import { truncateText } from '../../../utils/parsers'
import { readUrlContent, type UrlReadErrorCode } from '../../../utils/url-reader'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
  ToolLogDetails,
  WebSearchHandlerConfig,
} from './types'

interface AutoReadEvidenceItem {
  url: string
  title?: string
  excerpt?: string
  siteName?: string
  byline?: string
  wordCount?: number
  content?: string
  error?: string
  errorCode?: UrlReadErrorCode
  httpStatus?: number
  fallbackUsed: 'none' | 'search_snippet'
  rank: number
}

const DEFAULT_AUTO_READ_TOP_K = 2
const DEFAULT_AUTO_READ_TIMEOUT_MS = 18000
const DEFAULT_AUTO_READ_MAX_CONTENT_LENGTH = 24000
const DEFAULT_MODEL_EVIDENCE_CHARS = 2200

const parseRequestedLimit = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = Math.floor(value)
    return normalized > 0 ? normalized : null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

const clampAutoReadTopK = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(3, Math.floor(value)))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.min(3, Math.floor(parsed)))
    }
  }
  return DEFAULT_AUTO_READ_TOP_K
}

const clampPositiveInt = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)))
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, Math.floor(parsed)))
    }
  }
  return fallback
}

const isHttpUrl = (value: string): boolean => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const dedupeSearchUrls = (hits: Array<{ url?: string }>, limit: number): string[] => {
  if (limit <= 0) return []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const hit of hits) {
    const rawUrl = typeof hit.url === 'string' ? hit.url.trim() : ''
    if (!rawUrl || !isHttpUrl(rawUrl) || seen.has(rawUrl)) continue
    seen.add(rawUrl)
    urls.push(rawUrl)
    if (urls.length >= limit) break
  }
  return urls
}

const classifyWebSearchErrorCode = (message: string): string => {
  const normalized = (message || '').toLowerCase()
  if (normalized.includes('403')) return 'HTTP_403'
  if (normalized.includes('404')) return 'HTTP_404'
  if (normalized.includes('429')) return 'HTTP_429'
  if (normalized.includes('timeout')) return 'TIMEOUT'
  if (normalized.includes('fetch failed')) return 'FETCH_FAILED'
  return 'SEARCH_ERROR'
}

const buildSummaryForModel = (
  query: string,
  hits: Array<{ title: string; url: string; snippet?: string; content?: string }>,
  autoReadEvidence: AutoReadEvidenceItem[]
): string => {
  const base = formatHitsForModel(query, hits)
  if (autoReadEvidence.length === 0) {
    return `${base}\n\n注：本轮未读取网页正文，仅基于搜索摘要。`
  }

  const successItems = autoReadEvidence.filter((item) => !item.error)
  const failedItems = autoReadEvidence.filter((item) => item.error)
  const lines: string[] = []

  lines.push('自动网页读取证据（按搜索结果顺序）：')
  for (const item of autoReadEvidence) {
    if (item.error) {
      const fallbackSuffix =
        item.fallbackUsed === 'search_snippet' ? '，已回退为搜索摘要' : '，无可用回退正文'
      lines.push(
        `${item.rank}. 读取失败：${item.url} | ${item.errorCode || 'UNKNOWN'}${typeof item.httpStatus === 'number' ? ` (HTTP ${item.httpStatus})` : ''}${fallbackSuffix}`
      )
      if (item.content) {
        lines.push(`   回退摘要：${truncateText(item.content, 600)}`)
      }
      continue
    }
    const title = item.title || item.url
    lines.push(`${item.rank}. ${title}`)
    lines.push(`   URL: ${item.url}`)
    if (item.excerpt) {
      lines.push(`   摘要: ${truncateText(item.excerpt, 360)}`)
    }
    if (item.content) {
      lines.push(`   正文摘录: ${truncateText(item.content, DEFAULT_MODEL_EVIDENCE_CHARS)}`)
    }
  }

  return `${base}\n\n${lines.join('\n')}\n\n统计：自动读取成功 ${successItems.length} 条，失败 ${failedItems.length} 条。`
}

export class WebSearchToolHandler implements IToolHandler {
  readonly toolName = 'web_search'
  private config: WebSearchHandlerConfig

  constructor(config: WebSearchHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'web_search',
        description:
          'Use this tool to search the live web for up-to-date information before responding. Return queries in the same language as the conversation.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query describing the missing information',
            },
          },
          required: ['query'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult> {
    const query = ((args.query as string) || '').trim()
    const callId = toolCall.id || randomUUID()
    const reasoningMetaBase = { kind: 'tool', tool: 'web_search', query, callId }

    if (!query) {
      context.emitReasoning('模型请求了空的联网搜索参数，已忽略。', {
        ...reasoningMetaBase,
        stage: 'error',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query: '',
        error: 'Model requested web_search without a query',
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ error: 'Missing query parameter' }),
        },
      }
    }

    const modelRequestedLimit = parseRequestedLimit(args.num_results)
    const appliedLimit = this.config.resultLimit

    context.emitReasoning(`联网搜索：${query}（目标 ${appliedLimit} 条）`, {
      ...reasoningMetaBase,
      stage: 'start',
    })
    context.sendToolEvent({
      id: callId,
      tool: 'web_search',
      stage: 'start',
      query,
      details: {
        requestedLimit: modelRequestedLimit,
        appliedLimit,
      },
    })

    try {
      const hits = await runWebSearch(query, {
        engine: this.config.engine,
        apiKey: this.config.apiKey,
        limit: appliedLimit,
        domains: this.config.domains,
        endpoint: this.config.endpoint,
        scope: this.config.scope,
        includeSummary: this.config.includeSummary,
        includeRawContent: this.config.includeRawContent,
      })

      const autoReadEnabled = this.config.autoReadAfterSearch !== false
      const autoReadTopK = clampAutoReadTopK(this.config.autoReadTopK)
      const autoReadTimeoutMs = clampPositiveInt(
        this.config.autoReadTimeoutMs,
        DEFAULT_AUTO_READ_TIMEOUT_MS,
        3000,
        120000,
      )
      const autoReadMaxContentLength = clampPositiveInt(
        this.config.autoReadMaxContentLength,
        DEFAULT_AUTO_READ_MAX_CONTENT_LENGTH,
        2000,
        300000,
      )

      const autoReadTargets = autoReadEnabled ? dedupeSearchUrls(hits, autoReadTopK) : []
      const autoReadEvidence: AutoReadEvidenceItem[] = []

      for (const [index, targetUrl] of autoReadTargets.entries()) {
        const rank = index + 1
        const readCallId = `${callId}:read:${rank}`
        context.emitReasoning(`搜索后自动读取网页（${rank}/${autoReadTargets.length}）：${targetUrl}`, {
          ...reasoningMetaBase,
          stage: 'start',
          subTool: 'read_url',
          subCallId: readCallId,
          url: targetUrl,
          rank,
        })
        context.sendToolEvent({
          id: readCallId,
          tool: 'read_url',
          stage: 'start',
          query: targetUrl,
          summary: '基于搜索结果自动读取网页正文',
          url: targetUrl,
          details: {
            url: targetUrl,
            rank,
            autoTriggered: true,
            parentTool: 'web_search',
            parentCallId: callId,
          },
        })

        const readResult = await readUrlContent(targetUrl, {
          timeout: autoReadTimeoutMs,
          maxContentLength: autoReadMaxContentLength,
        })
        if (readResult.error) {
          const fallbackSnippet =
            hits.find((hit) => hit.url === targetUrl)?.content ||
            hits.find((hit) => hit.url === targetUrl)?.snippet ||
            ''
          const fallbackText = truncateText(fallbackSnippet, DEFAULT_MODEL_EVIDENCE_CHARS)
          const evidenceItem: AutoReadEvidenceItem = {
            url: targetUrl,
            error: readResult.error,
            errorCode: readResult.errorCode,
            httpStatus: readResult.httpStatus,
            content: fallbackText || undefined,
            fallbackUsed: fallbackText ? 'search_snippet' : 'none',
            rank,
          }
          autoReadEvidence.push(evidenceItem)

          const details: ToolLogDetails = {
            url: targetUrl,
            rank,
            autoTriggered: true,
            parentTool: 'web_search',
            parentCallId: callId,
            errorCode: readResult.errorCode,
            httpStatus: readResult.httpStatus,
            fallbackUsed: evidenceItem.fallbackUsed,
          }
          if (fallbackText) {
            details.resultText = fallbackText
          }

          context.emitReasoning(
            `网页读取失败：${targetUrl}（${readResult.errorCode || 'UNKNOWN'}${typeof readResult.httpStatus === 'number' ? ` / HTTP ${readResult.httpStatus}` : ''}）`,
            {
              ...reasoningMetaBase,
              stage: 'error',
              subTool: 'read_url',
              subCallId: readCallId,
              url: targetUrl,
              rank,
              errorCode: readResult.errorCode,
              httpStatus: readResult.httpStatus,
              fallbackUsed: evidenceItem.fallbackUsed,
            },
          )
          context.sendToolEvent({
            id: readCallId,
            tool: 'read_url',
            stage: 'error',
            query: targetUrl,
            summary:
              evidenceItem.fallbackUsed === 'search_snippet'
                ? '网页读取失败，已回退到搜索摘要'
                : '网页读取失败且无可用摘要回退',
            url: targetUrl,
            error: readResult.error,
            details,
          })
          continue
        }

        const evidenceItem: AutoReadEvidenceItem = {
          url: targetUrl,
          title: readResult.title || undefined,
          excerpt: readResult.excerpt || undefined,
          siteName: readResult.siteName || undefined,
          byline: readResult.byline || undefined,
          wordCount: readResult.wordCount,
          content: truncateText(readResult.textContent || '', DEFAULT_MODEL_EVIDENCE_CHARS),
          fallbackUsed: 'none',
          rank,
        }
        autoReadEvidence.push(evidenceItem)
        context.emitReasoning(
          `网页读取成功：${readResult.title || targetUrl}（约 ${readResult.wordCount || 0} 词）`,
          {
            ...reasoningMetaBase,
            stage: 'result',
            subTool: 'read_url',
            subCallId: readCallId,
            url: targetUrl,
            rank,
            title: readResult.title,
            wordCount: readResult.wordCount,
          },
        )
        context.sendToolEvent({
          id: readCallId,
          tool: 'read_url',
          stage: 'result',
          query: targetUrl,
          summary: readResult.title ? `已读取：${readResult.title}` : '网页读取完成',
          url: targetUrl,
          title: readResult.title,
          excerpt: readResult.excerpt,
          wordCount: readResult.wordCount,
          siteName: readResult.siteName,
          byline: readResult.byline,
          details: {
            url: targetUrl,
            rank,
            autoTriggered: true,
            parentTool: 'web_search',
            parentCallId: callId,
            title: readResult.title,
            excerpt: readResult.excerpt,
            wordCount: readResult.wordCount,
            siteName: readResult.siteName,
            byline: readResult.byline,
          },
        })
      }

      const autoReadSucceeded = autoReadEvidence.filter((item) => !item.error).length
      const autoReadFailed = autoReadEvidence.length - autoReadSucceeded
      const summary = buildSummaryForModel(query, hits, autoReadEvidence)

      context.emitReasoning(`获得 ${hits.length} 条结果，自动读取正文成功 ${autoReadSucceeded} 条。`, {
        ...reasoningMetaBase,
        stage: 'result',
        hits: hits.length,
        autoReadRequested: autoReadTargets.length,
        autoReadSucceeded,
        autoReadFailed,
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'result',
        query,
        hits,
        summary:
          autoReadTargets.length > 0
            ? `搜索完成，自动读取正文 ${autoReadSucceeded}/${autoReadTargets.length} 条`
            : `搜索完成，共 ${hits.length} 条结果`,
        details: {
          requestedLimit: modelRequestedLimit,
          appliedLimit,
          autoReadEnabled,
          autoReadRequested: autoReadTargets.length,
          autoReadSucceeded,
          autoReadFailed,
        },
      })

      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({
            query,
            hits,
            summary,
            autoReadEvidence,
            autoReadStats: {
              enabled: autoReadEnabled,
              requested: autoReadTargets.length,
              succeeded: autoReadSucceeded,
              failed: autoReadFailed,
            },
          }),
        },
      }
    } catch (searchError: unknown) {
      const message = searchError instanceof Error ? searchError.message : 'Web search failed'
      const errorCode = classifyWebSearchErrorCode(message)
      context.emitReasoning(`联网搜索失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
        errorCode,
      })
      context.sendToolEvent({
        id: callId,
        tool: 'web_search',
        stage: 'error',
        query,
        error: message,
        details: {
          errorCode,
          fallbackUsed: 'none',
        },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'web_search',
          content: JSON.stringify({ query, error: message, errorCode }),
        },
      }
    }
  }
}
