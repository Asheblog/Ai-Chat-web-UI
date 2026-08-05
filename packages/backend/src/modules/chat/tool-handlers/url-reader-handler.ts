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
import { assessWebImageRelevance } from '../../../utils/web-image-evidence'
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from './types'
import {
  isVisionProxyReady,
  type VisionProxyConfig,
  type VisionProxyService,
} from '../services/vision-proxy-service'

export interface UrlReaderHandlerConfig {
  enabled: boolean
  timeout?: number
  maxContentLength?: number
  maxBodyBytes?: number
  enableBrowser?: boolean
  browserExecutablePath?: string
  renderWaitMs?: number
}

export interface UrlReaderHandlerDeps {
  visionProxy?: VisionProxyConfig | null
  visionProxyService?: VisionProxyService
}

export class UrlReaderToolHandler implements IToolHandler {
  readonly toolName = 'read_url'
  private config: UrlReaderHandlerConfig
  private visionProxy: VisionProxyConfig | null
  private visionProxyService?: VisionProxyService

  constructor(config: UrlReaderHandlerConfig, deps: UrlReaderHandlerDeps = {}) {
    this.config = config
    this.visionProxy = deps.visionProxy ?? null
    this.visionProxyService = deps.visionProxyService
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

  private async assessPageImages(
    result: Awaited<ReturnType<typeof readUrlContent>>,
  ) {
    if (!this.visionProxyService || !this.visionProxy || !isVisionProxyReady(this.visionProxy)) {
      return []
    }
    const candidates = [
      ...(result.leadImageUrl
        ? [{ url: result.leadImageUrl, sourceUrl: result.url, title: result.title || undefined }]
        : []),
      ...((result.images || []).map((image) => ({
        url: image.url,
        alt: image.alt,
        width: image.width,
        height: image.height,
        source: image.source,
        sourceUrl: result.url,
        title: result.title || undefined,
      })) || []),
    ]
    return assessWebImageRelevance({
      candidates,
      contextText: [result.title, result.excerpt, result.textContent?.slice(0, 800)]
        .filter(Boolean)
        .join('\n'),
      visionProxy: this.visionProxyService,
      visionConfig: this.visionProxy,
    })
  }

  private canAttachVisionImages(context: ToolCallContext): boolean {
    const provider = (context.provider || '').toLowerCase()
    const visionEnabled = context.modelCapabilities?.vision === true
    return visionEnabled && (provider === 'openai' || provider === 'openai_responses' || provider === 'azure_openai')
  }

  private shouldAttachMultipleImages(result: Awaited<ReturnType<typeof readUrlContent>>): boolean {
    if (result.resourceType === 'image') return false
    const images = Array.isArray(result.images) ? result.images : []
    return images.length > 1 && !result.leadImageUrl
  }

  private async buildVisionFollowupMessages(
    result: Awaited<ReturnType<typeof readUrlContent>>,
    context: ToolCallContext,
  ): Promise<any[] | undefined> {
    if (!this.canAttachVisionImages(context)) return undefined
    const images = Array.isArray(result.images) ? result.images : []
    if (images.length === 0) return undefined

    const candidates = (() => {
      if (result.resourceType === 'image') {
        return images.slice(0, 1)
      }
      const preferred: typeof images = []
      if (result.leadImageUrl) {
        const lead = images.find((item) => item.url === result.leadImageUrl)
        if (lead) preferred.push(lead)
      }
      for (const image of images) {
        if (preferred.some((item) => item.url === image.url)) continue
        preferred.push(image)
      }
      return preferred.slice(0, this.shouldAttachMultipleImages(result) ? 3 : 1)
    })()

    const downloaded = await readRemoteImages(candidates, {
      timeoutMs: Math.max(4000, this.config.timeout ?? 12000),
      maxCount: result.resourceType === 'image' ? 1 : candidates.length,
    })
    if (downloaded.length === 0) return undefined

    const introText =
      result.resourceType === 'image'
        ? `以下图片来自用户提供的图片 URL：${result.url}。请直接结合图片内容回答。`
        : `以下图片来自刚读取的网页 ${result.url}，请结合网页正文和图片内容回答。`

    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: introText },
          ...downloaded.map((item) => ({
            type: 'image_url',
            image_url: {
              url: `data:${item.mime};base64,${item.data}`,
            },
          })),
        ],
      },
    ]
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
      const result = await readUrlContent(url, {
        timeout: this.config.timeout,
        maxContentLength: this.config.maxContentLength,
        maxBodyBytes: this.config.maxBodyBytes,
        enableBrowser: this.config.enableBrowser,
        browserExecutablePath: this.config.browserExecutablePath,
        renderWaitMs: this.config.renderWaitMs,
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

      const followupMessages = await this.buildVisionFollowupMessages(result, context)
      const visionReady = Boolean(
        this.visionProxyService && this.visionProxy && isVisionProxyReady(this.visionProxy),
      )
      const assessedImages = visionReady ? await this.assessPageImages(result) : []
      const assessedForDetails = assessedImages.map((item) => ({
        url: item.url,
        title: item.title || item.alt,
        alt: item.alt,
        sourceUrl: item.sourceUrl || result.url,
        confidence: item.confidence,
        description: item.description,
        relevance: item.relevance,
      }))
      const imageEvidenceText =
        assessedForDetails.length > 0
          ? [
              '',
              '【图片证据（已识图筛选）】',
              ...assessedForDetails.map(
                (item, index) =>
                  `[图${index + 1}] ${item.description || item.title || item.url}（${item.relevance}） ${item.url}`,
              ),
            ].join('\n')
          : ''
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        query: url,
        summary: result.resourceType === 'image'
          ? '图片读取完成'
          : result.title
            ? `已读取：${result.title}${result.fallbackUsed === 'crawler' ? '（爬虫回退）' : ''}`
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
          contentType: result.contentType,
          contentLength: result.contentLength,
          leadImageUrl: result.leadImageUrl,
          images: result.images,
          assessedImages: assessedForDetails,
          visionFollowupAttached: Boolean(followupMessages?.length),
        },
      })

      const formatted = `${formatUrlContentForModel(result, {
        // 识图已跑过：只保留相关图描述；未配置识图时仍回退原始图片 URL 证据
        includeRawImageEvidence: !visionReady,
      })}${imageEvidenceText}`
      return {
        toolCallId: callId,
        toolName: this.toolName,
        message: {
          role: 'tool',
          tool_call_id: toolCall.id,
          name: 'read_url',
          content: formatted,
        },
        ...(followupMessages ? { followupMessages } : {}),
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
