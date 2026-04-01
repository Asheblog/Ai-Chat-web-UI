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
import type {
  IToolHandler,
  ToolCall,
  ToolCallContext,
  ToolDefinition,
  ToolHandlerResult,
} from './types'

export interface UrlReaderHandlerConfig {
  enabled: boolean
  timeout?: number
  maxContentLength?: number
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
    const reasoningMetaBase = { kind: 'tool', tool: 'read_url', url, callId }

    if (!url) {
      context.emitReasoning('模型请求读取 URL 但未提供地址，已忽略。', {
        ...reasoningMetaBase,
        stage: 'error',
      })
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
    if (likelySPA) {
      context.emitReasoning(
        `注意：该网址可能是动态页面，内容提取可能不完整。正在尝试读取：${url}`,
        { ...reasoningMetaBase, stage: 'start', warning: 'possible_spa' }
      )
    } else {
      context.emitReasoning(`正在读取网页：${url}`, { ...reasoningMetaBase, stage: 'start' })
    }

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
      })

      if (result.error) {
        const errorLabel = result.errorCode
          ? `${result.error}（${result.errorCode}${typeof result.httpStatus === 'number' ? ` / HTTP ${result.httpStatus}` : ''}）`
          : result.error
        context.emitReasoning(`读取网页失败：${errorLabel}`, {
          ...reasoningMetaBase,
          stage: 'error',
          errorCode: result.errorCode,
          httpStatus: result.httpStatus,
        })
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
            }),
          },
        }
      }

      const extractionMode =
        result.resourceType === 'image'
          ? 'direct-image'
          : result.fallbackUsed === 'crawler'
            ? 'crawler'
            : 'readability'
      const followupMessages = await this.buildVisionFollowupMessages(result, context)
      context.emitReasoning(
        result.resourceType === 'image'
          ? `成功读取图片资源：${url}。`
          : `成功读取网页「${result.title || url}」，共约 ${result.wordCount || 0} 词（${extractionMode}）。`,
        {
          ...reasoningMetaBase,
          stage: 'result',
          title: result.title,
          wordCount: result.wordCount,
          fallbackUsed: result.fallbackUsed || 'none',
          resourceType: result.resourceType || 'page',
        }
      )
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
          contentType: result.contentType,
          contentLength: result.contentLength,
          leadImageUrl: result.leadImageUrl,
          images: result.images,
          visionFollowupAttached: Boolean(followupMessages?.length),
        },
      })

      const formatted = formatUrlContentForModel(result)
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
      context.emitReasoning(`读取网页失败：${message}`, {
        ...reasoningMetaBase,
        stage: 'error',
      })
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
