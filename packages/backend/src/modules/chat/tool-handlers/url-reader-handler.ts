/**
 * URL 读取工具处理器
 * 使用 @mozilla/readability 自建实现，无需外部 API
 */

import { randomUUID } from 'node:crypto'
import {
  readUrlContent,
  formatUrlContentForModel,
  checkIfLikelySPA,
} from '../../../utils/url-reader'
import { readRemoteImages } from '../../../utils/remote-image-reader'
import type { ToolImageEvidence } from '../../../utils/tool-image-evidence'
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
  ) {
    const provider = (context.provider || '').toLowerCase()
    const direct = result.resourceType === 'image'
    const supportsToolImages = provider === 'openai_responses' || provider === 'anthropic'
    if (context.modelCapabilities?.vision !== true || !supportsToolImages) return []
    if (!direct && result.resourceType && result.resourceType !== 'page') return []

    const images = result.images ?? []
    if (images.length === 0) return []
    const lead = images.find((image) => image.url === result.leadImageUrl)
    const candidates = lead ? [lead] : images.slice(0, direct || result.leadImageUrl ? 1 : 3)
    return readRemoteImages(candidates, {
      timeoutMs: Math.max(4000, this.config.timeout ?? 12000),
      maxCount: candidates.length,
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
      },
    })

    try {
      const purpose = args.purpose === 'history' ? 'history' : 'current'
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
        signal: context.requestSignal,
      })

      if (result.error) {
        context.sendToolEvent({
          id: callId,
          tool: 'read_url',
          stage: 'error',
          query: url,
          summary: result.errorCode ? `读取网页失败（${result.errorCode}）` : '读取网页失败',
          url,
          error: result.error,
          details: {
            url,
            errorCode: result.errorCode,
            httpStatus: result.httpStatus,
            fallbackUsed: 'none',
            attempts: result.attempts,
            finalUrl: result.finalUrl,
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
              error: result.error,
              errorCode: result.errorCode,
              httpStatus: result.httpStatus,
              attempts: result.attempts,
              finalUrl: result.finalUrl,
            }),
          },
        }
      }

      const downloaded = await this.downloadImages(result, context)
      const imageEvidence: ToolImageEvidence | undefined = downloaded.length > 0 ? {
        kind: result.resourceType === 'image' ? 'resource' : 'page',
        sourceUrl: result.finalUrl || result.url,
        title: result.title,
        images: downloaded.map((item) => ({
          imageUrl: item.requestedUrl,
          dataUrl: `data:${item.mime};base64,${item.data}`,
          alt: item.alt,
        })),
      } : undefined
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        query: url,
        summary: result.resourceType === 'image'
          ? '图片读取完成'
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
          content: formatted,
          ...(imageEvidence ? { imageEvidence } : {}),
        },
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'URL read failed'
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'error',
        query: url,
        summary: '读取网页失败',
        url,
        error: message,
        details: {
          url,
        },
      })
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: JSON.stringify({ url, error: message }),
        },
      }
    }
  }
}
