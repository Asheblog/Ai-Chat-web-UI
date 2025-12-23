import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import { AuthUtils as defaultAuthUtils } from '../../../utils/auth'
import { buildHeaders, type ProviderType, type AuthType } from '../../../utils/providers'
import { BackendLogger as log } from '../../../utils/logger'

export interface TitleSummaryConfig {
  enabled: boolean
  maxLength: number
  modelSource: 'current' | 'specified'
  connectionId: number | null
  modelId: string | null
}

export interface TitleSummaryRequest {
  sessionId: number
  content: string
  config: TitleSummaryConfig
}

export interface TitleSummaryResult {
  title: string
}

export class TitleSummaryServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'TitleSummaryServiceError'
    this.statusCode = statusCode
  }
}

export interface TitleSummaryServiceDeps {
  prisma?: PrismaClient
  authUtils?: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  fetchFn?: typeof fetch
}

export class TitleSummaryService {
  private prisma: PrismaClient
  private authUtils: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  private fetchFn: typeof fetch

  constructor(deps: TitleSummaryServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.fetchFn = deps.fetchFn ?? fetch
  }

  async generateTitle(request: TitleSummaryRequest): Promise<TitleSummaryResult> {
    const { sessionId, content, config } = request

    if (!config.enabled) {
      throw new TitleSummaryServiceError('Title summary is disabled', 400)
    }

    // 获取会话信息
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { connection: true },
    })

    if (!session) {
      throw new TitleSummaryServiceError('Session not found', 404)
    }

    // 确定使用哪个模型
    let connectionId: number | null
    let modelId: string | null
    let connection: typeof session.connection

    if (config.modelSource === 'specified' && config.connectionId && config.modelId) {
      // 使用指定模型
      connectionId = config.connectionId
      modelId = config.modelId
      const specifiedConnection = await this.prisma.connection.findUnique({
        where: { id: connectionId },
      })
      if (!specifiedConnection) {
        throw new TitleSummaryServiceError('Specified connection not found', 404)
      }
      connection = specifiedConnection
    } else {
      // 使用当前会话模型
      if (!session.connectionId || !session.connection || !session.modelRawId) {
        throw new TitleSummaryServiceError('Session model not configured', 400)
      }
      connectionId = session.connectionId
      modelId = session.modelRawId
      connection = session.connection
    }

    // 构建请求
    const systemPrompt = `你是一个标题生成器。根据用户的消息内容，生成一个简洁、准确的对话标题。
要求：
- 不超过${config.maxLength}个字
- 概括对话主题
- 不使用标点符号结尾
- 只返回标题文本，不要有其他内容`

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content },
    ]

    const deriveLocalTitle = (text: string, limit: number) => {
      let s = (text || '')
        .replace(/```[\s\S]*?```/g, ' ') // 去掉代码块
        .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ') // 去掉图片/markdown
        .replace(/^[#>\-\*\s]+/gm, '') // 去掉前缀标记
        .replace(/\n+/g, ' ')
        .trim()
      if (!s) return ''
      if (s.length > limit) {
        s = Array.from(s).slice(0, limit).join('')
      }
      return s
    }

    const provider = connection.provider as ProviderType
    const endpoint = (connection.baseUrl || '').trim().replace(/\/+$/, '')
    const authType = connection.authType as AuthType
    const apiKey = this.authUtils.decryptApiKey(connection.apiKey)

    if (!endpoint) {
      throw new TitleSummaryServiceError('Connection baseUrl is not configured', 400)
    }

    if (!modelId) {
      throw new TitleSummaryServiceError('Model is not configured for title summary', 400)
    }

    // 解析额外请求头
    let extraHeaders: Record<string, string> | undefined
    try {
      if (connection.headersJson && connection.headersJson.trim()) {
        extraHeaders = JSON.parse(connection.headersJson)
      }
    } catch {
      // ignore invalid JSON
    }

    // 构建URL
    let url: string
    if (provider === 'ollama') {
      url = `${endpoint}/api/chat`
    } else if (provider === 'azure_openai') {
      const apiVersion = connection.azureApiVersion || '2024-02-15-preview'
      url = `${endpoint}/openai/deployments/${encodeURIComponent(
        modelId,
      )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    } else {
      url = `${endpoint}/chat/completions`
    }

    // 构建请求头 (async)
    const headers = await buildHeaders(provider, authType, apiKey, extraHeaders)

    // 构建请求体
    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      temperature: 0.3,
      stream: false,
    }

    try {
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        log.warn('[title-summary] Provider request failed', {
          sessionId,
          status: response.status,
          url,
          error: errorText.slice(0, 200),
        })
        const fallback = deriveLocalTitle(content, config.maxLength)
        if (fallback) {
          return { title: fallback }
        }
        throw new TitleSummaryServiceError(`Provider request failed: ${response.status}`, 502)
      }

      const rawText = await response.text()
      let json: {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
        message?: { content?: string; reasoning_content?: string }
      } = {}
      try {
        json = JSON.parse(rawText)
      } catch {
        // ignore parse error; rawText 会在日志里记录
      }

      // 提取响应内容
      let title =
        json?.choices?.[0]?.message?.content ||
        json?.choices?.[0]?.message?.reasoning_content ||
        json?.message?.content ||
        json?.message?.reasoning_content ||
        ''
      title = title.trim()

      // 确保标题长度不超过限制
      if (title.length > config.maxLength) {
        title = Array.from(title).slice(0, config.maxLength).join('')
      }

      // 移除可能的标点符号结尾
      title = title.replace(/[，。！？、；：""''【】《》（）\.\!\?\,\;\:\"\'\[\]\(\)\{\}]$/g, '')

      if (!title) {
        const fallback = deriveLocalTitle(content, config.maxLength)
        if (fallback) return { title: fallback }
        throw new TitleSummaryServiceError('Empty response from provider', 502)
      }

      log.info('[title-summary] Generated title', {
        sessionId,
        titleLength: title.length,
      })

      return { title }
    } catch (error) {
      if (error instanceof TitleSummaryServiceError) {
        if (error.statusCode >= 500) {
          const fallback = deriveLocalTitle(content, config.maxLength)
          if (fallback) return { title: fallback }
        }
        throw error
      }
      log.error('[title-summary] Unexpected error', { sessionId, error })
      const fallback = deriveLocalTitle(content, config.maxLength)
      if (fallback) return { title: fallback }
      throw new TitleSummaryServiceError('Failed to generate title', 500)
    }
  }
}

export const titleSummaryService = new TitleSummaryService()
