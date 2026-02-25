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
        context.emitReasoning(`读取网页失败：${result.error}`, {
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
          error: result.error,
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
            content: JSON.stringify({ url, error: result.error }),
          },
        }
      }

      context.emitReasoning(
        `成功读取网页「${result.title || url}」，共约 ${result.wordCount || 0} 词。`,
        {
          ...reasoningMetaBase,
          stage: 'result',
          title: result.title,
          wordCount: result.wordCount,
        }
      )
      context.sendToolEvent({
        id: callId,
        tool: 'read_url',
        stage: 'result',
        query: url,
        summary: result.title
          ? `已读取：${result.title}`
          : '网页读取完成',
        url,
        title: result.title,
        excerpt: result.excerpt,
        wordCount: result.wordCount,
        siteName: result.siteName,
        byline: result.byline,
        details: {
          url,
          title: result.title,
          excerpt: result.excerpt,
          wordCount: result.wordCount,
          siteName: result.siteName,
          byline: result.byline,
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
