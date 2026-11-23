/**
 * URL 读取工具处理器
 * 使用 @mozilla/readability 自建实现，无需外部 API
 *
 * #119 相关契约：
 * - 同一任务内 web_search 已取得的 article 正文可复用，走 readUrlContent 的 providedContent 入口；
 *   复用结果的 fallbackUsed='provided'，机读摘要 source='provider'，不与「原站抓取成功」混同。
 * - purpose='history' 或显式 fresh=true 一律直读原站，保持历史/新鲜读取的原契约与时效语义。
 * - 二进制图片只在显式 include_images 或直读图片资源时回传；文字结果里的图片链接始终保留。
 * - 取消不包装成工具错误：返回 JSON 结论 status='cancelled'，不带 error 字段。
 */

import { randomUUID } from 'node:crypto'
import {
  readUrlContent,
  formatUrlContentForModel,
  checkIfLikelySPA,
} from '../../../utils/url-reader'
import { readRemoteImages } from '../../../utils/remote-image-reader'
import { supportsToolImages, type ToolImageEvidence } from '../../../utils/tool-image-evidence'
import { buildSearchEvidenceTaskKey, lookupSearchEvidence } from './web-search-evidence-store'
import {
  buildEvidenceSummary,
  mapReadFailureKind,
  mapReadFailureReason,
  type EvidenceSummary,
  type ReadFailureReason,
  type RetrievalEngineState,
  type RetrievalOutcome,
} from './web-search-outcome'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from '../../../agent-runtime/tool-handler-types'

export interface UrlReaderHandlerConfig {
  enabled: boolean
  enableDeepseekFallback?: boolean
  deepseekApiKey?: string
  timeout?: number
  maxContentLength?: number
  maxBodyBytes?: number
  enableBrowser?: boolean
  browserExecutablePath?: string
  renderWaitMs?: number
}

const parseBooleanArg = (value: unknown): boolean => value === true || value === 'true'

type UrlReadStatus = 'success' | 'empty' | 'failed' | 'timeout' | 'cancelled'

const READ_STATUS_REASON: Record<UrlReadStatus, RetrievalOutcome['reason']> = {
  success: 'results',
  empty: 'no_content',
  failed: 'read_failed',
  timeout: 'read_failed',
  cancelled: 'request_cancelled',
}

const READ_ENGINE_STATE: Record<UrlReadStatus, RetrievalEngineState> = {
  success: 'ok',
  empty: 'ok',
  failed: 'error',
  timeout: 'timed_out',
  cancelled: 'cancelled',
}

/**
 * 读取结果给出与搜索同形状的 retrievalOutcome，但不伪造搜索任务或自动阅读批次：
 * search 计数全 0（本次没有搜索任务），autoRead 记为关闭（没有自动阅读），
 * evidence 只记这一次读取的真实正文条数，engines 只描述实际使用的读取引擎。
 */
const buildReadOutcome = (input: {
  url: string
  engine?: string
  status: UrlReadStatus
  body: boolean
  contentKind?: string
  failureKind?: RetrievalOutcome['engines'][number]['failureKind']
  errorCode?: string
  httpStatus?: number
}): RetrievalOutcome => {
  const engine = input.engine || 'native'
  const isStructured = input.contentKind === 'structured'
  const isSummary = input.contentKind === 'summary'
  const evidence = {
    article: input.body && !isStructured && !isSummary ? 1 : 0,
    structured: input.body && isStructured ? 1 : 0,
    summary: input.body && isSummary ? 1 : 0,
    none: input.body ? 0 : 1,
  }
  const failureKind = input.failureKind
  const retryable =
    input.status === 'timeout' ||
    (input.status === 'failed' && Boolean(failureKind === 'upstream_error' || failureKind === 'network' || failureKind === 'rate_limited'))
  return {
    status: input.status,
    reason: READ_STATUS_REASON[input.status],
    retryable,
    retryAfterMs: null,
    degraded: input.status !== 'success',
    cancellation: {
      requested: input.status === 'cancelled',
      source: input.status === 'cancelled' ? 'request' : null,
    },
    search: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      empty: 0,
      timedOut: 0,
      cancelled: 0,
      skippedBackoff: 0,
      failureKinds: {},
      exhaustion: 'none',
    },
    autoRead: {
      state: 'off',
      requested: 0,
      candidatesExamined: 0,
      bodies: 0,
      summaryOnly: 0,
      failed: 0,
      skipped: 0,
    },
    evidence,
    engines: [
      {
        engine,
        state: READ_ENGINE_STATE[input.status],
        ...(failureKind ? { failureKind } : {}),
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
        ...(typeof input.httpStatus === 'number' ? { httpStatus: input.httpStatus } : {}),
      },
    ],
    timeRange: null,
    restriction: { restricted: false, requested: [], effective: [] },
    escalation: { triggered: false, reason: null },
  }
}

const buildReadEvidenceSummary = (input: {
  url: string
  body: boolean
  contentKind?: string
  truncated?: boolean
  engine?: string
  source: 'origin' | 'provider'
  reason?: ReadFailureReason
}): EvidenceSummary =>
  buildEvidenceSummary({
    source: input.source,
    queries: [],
    hits: input.body ? 1 : 0,
    evidence: {
      article: input.body && input.contentKind !== 'structured' && input.contentKind !== 'summary' ? 1 : 0,
      structured: input.body && input.contentKind === 'structured' ? 1 : 0,
      summary: input.body && input.contentKind === 'summary' ? 1 : 0,
      none: input.body ? 0 : 1,
    },
    engines: input.engine ? [input.engine] : [],
    failures: input.reason ? [{ url: input.url, reason: input.reason }] : [],
    truncated: input.truncated ? 1 : 0,
    restriction: { restricted: false, requested: [], effective: [] },
    timeRange: null,
  })

/** 稳定的机读摘要尾块：answer-runtime 只读这一行 JSON，不解析正文。 */
const appendRetrievalSummary = (content: string, summary: EvidenceSummary): string =>
  `${content}\n\n## 检索摘要\n${JSON.stringify(summary)}`

export class UrlReaderToolHandler implements IToolHandler {
  readonly toolName = 'read_url'
  private config: UrlReaderHandlerConfig

  constructor(config: UrlReaderHandlerConfig) {
    this.config = config
  }

  get toolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'read_url',
        description:
          'Read and extract the main content from a specific URL/webpage. Use this tool when the user provides a URL and wants to know its content, summarize it, or extract information from it. Works best with articles, blog posts, news, documentation, and similar text-heavy pages. Note: Some dynamic/JavaScript-heavy pages may not be readable. Do NOT use this for general web searches - use web_search instead.',
        parameters: {
          type: 'object',
          properties: {
            purpose: {
              type: 'string',
              enum: ['current', 'history'],
              description: 'Use current for the live page (default). Use history only when the user explicitly requests historical content or an archived version; archived content carries its snapshot timestamp.',
            },
            url: {
              type: 'string',
              description: 'The complete URL to read content from (e.g., https://example.com/article)',
            },
            fresh: {
              type: 'boolean',
              description: 'Set true to force a live read of the original site and skip reusing body text that web_search already returned for this URL in this task. Use it when the caller needs a refresh or the original page itself.',
            },
            include_images: {
              type: 'boolean',
              description: 'Set true only when binary page images are needed as evidence. Image URLs are always listed in the text result, and the URL itself is unaffected.',
            },
          },
          required: ['url'],
        },
      },
    }
  }

  canHandle(toolName: string): boolean {
    return toolName === this.toolName
  }

  private async downloadImages(
    result: Awaited<ReturnType<typeof readUrlContent>>,
    context: ToolCallContext,
    includeImages: boolean,
  ) {
    const direct = result.resourceType === 'image'
    // 直读图片资源本身就是内容；页内配图只在显式请求时下载，避免默认开销
    if (!direct && !includeImages) return []
    if (context.modelCapabilities?.vision !== true || !supportsToolImages(context.provider)) return []
    if (!direct && result.resourceType && result.resourceType !== 'page') return []

    const images = result.images ?? []
    if (images.length === 0) return []
    const lead = images.find((image) => image.url === result.leadImageUrl)
    const candidates = lead ? [lead] : images.slice(0, direct || result.leadImageUrl ? 1 : 3)
    return readRemoteImages(candidates, {
      timeoutMs: Math.max(4000, this.config.timeout ?? 12000),
      maxCount: candidates.length,
      signal: context.requestSignal,
    })
  }

  async handle(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    context: ToolCallContext
  ): Promise<ToolHandlerResult> {
    const url = ((args.url as string) || '').trim()
    const callId = toolCall.id || randomUUID()

    if (!url) {
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'error',
        url: '',
        error: 'Model requested read_url without a URL',
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({ error: 'Missing URL parameter' }),
        },
      }
    }

    const purpose = args.purpose === 'history' ? 'history' : 'current'
    const includeImages = parseBooleanArg(args.include_images)
    const fresh = parseBooleanArg(args.fresh)
    const likelySPA = checkIfLikelySPA(url)

    context.sendToolEvent({
      id: callId,
      tool: 'read_url',
      stage: 'start',
      query: url,
      summary: likelySPA ? '检测到可能是动态网页，尝试提取正文' : '开始读取网页正文',
      url,
      warning: likelySPA ? 'possible_spa' : undefined,
      details: {
        url,
        warning: likelySPA ? 'possible_spa' : undefined,
        purpose,
        includeImages,
        fresh,
      },
    })

    // 取消优先：已取消的请求不再发起新的读取
    if (context.requestSignal?.aborted) {
      const outcome = buildReadOutcome({
        url,
        status: 'cancelled',
        body: false,
        failureKind: 'cancelled',
        errorCode: 'CANCELLED',
      })
      const evidenceSummary = buildReadEvidenceSummary({
        url,
        body: false,
        source: 'origin',
        reason: 'cancelled',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        query: url,
        summary: '网页读取已取消',
        url,
        details: { url, cancelled: true, retrievalOutcome: outcome, evidenceSummary },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({ url, cancelled: true, retrievalOutcome: outcome, evidenceSummary }),
        },
      }
    }

    // 同任务正文复用：只复用同一 session+message 内搜索取得的、未被提供方截断的 article 正文。
    // 历史用途与 fresh=true 一律直读原站，保持既有时效与历史契约。
    // 结构化正文没有对应的复用种类（ProvidedContent.kind 只有 article/summary/snippet），
    // 按 article 复用会把种类降级掉，因此只复用 article。
    const taskKey = buildSearchEvidenceTaskKey(context)
    const stored = purpose === 'current' && !fresh ? lookupSearchEvidence(taskKey, url) : undefined
    const cached = stored?.contentKind === 'article' ? stored : undefined
    const providedContent = cached
      ? {
          content: cached.content,
          kind: 'article' as const,
          source: cached.source,
          ...(cached.fetchedAt ? { fetchedAt: cached.fetchedAt } : {}),
        }
      : undefined

    try {
      const result = await readUrlContent(url, {
        purpose,
        freshness: purpose === 'history' ? 'default' : 'current',
        timeout: this.config.timeout,
        maxContentLength: this.config.maxContentLength,
        maxBodyBytes: this.config.maxBodyBytes,
        enableBrowser: this.config.enableBrowser,
        browserExecutablePath: this.config.browserExecutablePath,
        renderWaitMs: this.config.renderWaitMs,
        enableDeepseekFallback: this.config.enableDeepseekFallback,
        deepseekApiKey: this.config.deepseekApiKey,
        ...(providedContent ? { providedContent } : {}),
        signal: context.requestSignal,
      })

      const reused = Boolean(providedContent) && (result.fallbackUsed === 'provided' || result.engine === 'provided')
      const readSource: 'origin' | 'provider' = reused ? 'provider' : 'origin'

      if (result.error) {
        const cancelled =
          result.errorCode === 'CANCELLED' || Boolean(context.requestSignal?.aborted)
        const failureKind = cancelled ? 'cancelled' : mapReadFailureKind(result.errorCode)
        const status: UrlReadStatus = cancelled
          ? 'cancelled'
          : failureKind === 'timeout'
            ? 'timeout'
            : 'failed'
        const outcome = buildReadOutcome({
          url,
          engine: result.engine,
          status,
          body: false,
          failureKind,
          errorCode: result.errorCode,
          httpStatus: result.httpStatus,
        })
        const evidenceSummary = buildReadEvidenceSummary({
          url,
          body: false,
          engine: result.engine,
          source: readSource,
          reason: mapReadFailureReason(result.errorCode),
        })
        context.sendToolEvent({
          id: callId,
          tool: 'read_url',
          stage: cancelled ? 'result' : 'error',
          query: url,
          summary: cancelled
            ? '网页读取已取消'
            : result.errorCode
              ? `读取网页失败（${result.errorCode}）`
              : '读取网页失败',
          url,
          ...(cancelled ? {} : { error: result.error }),
          details: {
            url,
            errorCode: result.errorCode,
            httpStatus: result.httpStatus,
            fallbackUsed: 'none',
            attempts: result.attempts,
            finalUrl: result.finalUrl,
            cancelled,
            retrievalOutcome: outcome,
            evidenceSummary,
          },
        })
        return {
          toolCallId: callId,
          toolName: this.toolName,
          message: {
            role: 'tool',
            tool_call_id: toolCall.id,
            name: 'read_url',
            content: JSON.stringify({
              url,
              ...(cancelled
                ? { cancelled: true }
                : { error: result.error, errorCode: result.errorCode, httpStatus: result.httpStatus }),
              attempts: result.attempts,
              finalUrl: result.finalUrl,
              retrievalOutcome: outcome,
              evidenceSummary,
            }),
          },
        }
      }

      const downloaded = await this.downloadImages(result, context, includeImages)
      const imageEvidence: ToolImageEvidence | undefined = downloaded.length > 0 ? {
        kind: result.resourceType === 'image' ? 'resource' : 'page',
        images: downloaded.map((item) => ({
          sourceUrl: result.finalUrl || result.url,
          title: result.title,
          imageUrl: item.requestedUrl,
          dataUrl: `data:${item.mime};base64,${item.data}`,
          alt: item.alt,
        })),
      } : undefined

      const body = result.resourceType === 'image' || (result.textContent || '').trim().length > 0
      const outcome = buildReadOutcome({
        url,
        engine: result.engine,
        status: body ? 'success' : 'empty',
        body,
        contentKind: result.contentKind,
      })
      const evidenceSummary = buildReadEvidenceSummary({
        url,
        body,
        contentKind: result.contentKind,
        truncated: result.truncated,
        engine: result.engine,
        source: readSource,
      })

      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        query: url,
        summary: result.resourceType === 'image'
          ? '图片读取完成'
          : reused
            ? '已复用同任务搜索正文（未重新抓取）'
            : result.title
              ? `已读取：${result.title}${result.fallbackUsed === 'crawler' ? '（爬虫回退）' : result.fallbackUsed === 'deepseek_fetch' ? '（DeepSeek 抓取）' : ''}`
              : result.fallbackUsed === 'crawler'
                ? '网页读取完成（爬虫回退）'
                : '网页读取完成',
        url,
        title: result.title,
        excerpt: result.excerpt,
        wordCount: result.wordCount,
        siteName: result.siteName,
        byline: result.byline,
        leadImageUrl: result.leadImageUrl,
        details: {
          url,
          enableDeepseekFallback: Boolean(this.config.enableDeepseekFallback && this.config.deepseekApiKey),
          title: result.title,
          excerpt: result.excerpt,
          wordCount: result.wordCount,
          siteName: result.siteName,
          byline: result.byline,
          fallbackUsed: result.fallbackUsed || 'none',
          resourceType: result.resourceType || 'page',
          engine: result.engine,
          attempts: result.attempts,
          finalUrl: result.finalUrl,
          rendered: result.rendered,
          confidence: result.confidence,
          contentFormat: result.contentFormat,
          contentKind: result.contentKind,
          fetchedAt: result.fetchedAt,
          archivedAt: result.archivedAt,
          truncated: result.truncated,
          contentType: result.contentType,
          contentLength: result.contentLength,
          leadImageUrl: result.leadImageUrl,
          images: result.images,
          contentSource: readSource,
          // 复用只声明通用来源类别 provider；真实提供方放在独立字段，不改共享枚举
          ...(reused
            ? {
                reusedFrom: 'search_content',
                ...(cached?.source ? { contentProvider: cached.source } : {}),
              }
            : {}),
          retrievalOutcome: outcome,
          evidenceSummary,
          ...(imageEvidence ? { toolImageEvidenceCount: imageEvidence.images.length } : {}),
        },
      })

      // 联网图片证据直接给原始 URL；formatUrlContentForModel 内部按「有无图片」决定是否输出该段
      const formatted = formatUrlContentForModel(result)
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: appendRetrievalSummary(formatted, evidenceSummary),
          ...(imageEvidence ? { imageEvidence } : {}),
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'URL read failed'
      const cancelled = Boolean(context.requestSignal?.aborted)
      const outcome = buildReadOutcome({
        url,
        status: cancelled ? 'cancelled' : 'failed',
        body: false,
        failureKind: cancelled ? 'cancelled' : 'upstream_error',
        errorCode: cancelled ? 'CANCELLED' : 'UNKNOWN',
      })
      const evidenceSummary = buildReadEvidenceSummary({
        url,
        body: false,
        source: 'origin',
        reason: cancelled ? 'cancelled' : 'unknown',
      })
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: cancelled ? 'result' : 'error',
        query: url,
        summary: cancelled ? '网页读取已取消' : '读取网页失败',
        url,
        ...(cancelled ? {} : { error: message }),
        details: { url, cancelled, retrievalOutcome: outcome, evidenceSummary },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({
            url,
            ...(cancelled ? { cancelled: true } : { error: message }),
            retrievalOutcome: outcome,
            evidenceSummary,
          }),
        },
      }
    }
  }
}
