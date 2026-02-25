import type { Prisma, PrismaClient } from '@prisma/client'
import type { z } from 'zod'
import { prisma as defaultPrisma } from '../../../db'
import { Tokenizer } from '../../../utils/tokenizer'
import {
  resolveCompletionLimit as defaultResolveCompletionLimit,
  resolveContextLimit as defaultResolveContextLimit,
} from '../../../utils/context-window'
import { cleanupExpiredChatImages as defaultCleanupExpiredChatImages } from '../../../utils/chat-images'
import { AuthUtils as defaultAuthUtils } from '../../../utils/auth'
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../../config/storage'
import {
  buildHeaders,
  type AuthType,
  type ProviderType,
} from '../../../utils/providers'
import { buildChatProviderRequest } from '../../../utils/chat-provider'
import { sendMessageSchema } from '../chat-common'
import { BUILTIN_SKILL_SLUGS, normalizeRequestedSkills } from '../../skills/types'

type SendMessagePayload = z.infer<typeof sendMessageSchema>
type ChatSessionWithConnection = Prisma.ChatSessionGetPayload<{ include: { connection: true } }>

export interface PreparedChatRequest {
  promptTokens: number
  contextLimit: number
  contextRemaining: number
  appliedMaxTokens: number
  contextEnabled: boolean
  systemSettings: Record<string, string>
  providerRequest: {
    providerLabel: ProviderType
    providerHost: string | null
    baseUrl: string
    rawModelId: string
    azureApiVersion?: string | null
    url: string
    headers: Record<string, string>
    authHeader: Record<string, string>
    extraHeaders: Record<string, string>
    body: any
    timeoutMs: number
  }
  messagesPayload: any[]
  baseRequestBody: any
  reasoning: {
    enabled: boolean
    effort: string
    ollamaThink: boolean
  }
}

export interface PrepareChatRequestParams {
  session: ChatSessionWithConnection
  payload: SendMessagePayload
  content: string
  images?: Array<{ data: string; mime: string }>
  historyUpperBound?: Date | null
  mode: 'stream' | 'completion'
  personalPrompt?: string | null
  extraSystemPrompts?: string[]
  /** RAG 增强上下文（从文档检索获取） */
  ragContext?: string | null
}

export interface ChatRequestBuilderDeps {
  prisma?: PrismaClient
  tokenizer?: Pick<typeof Tokenizer, 'truncateMessages' | 'countConversationTokens'>
  resolveContextLimit?: typeof defaultResolveContextLimit
  resolveCompletionLimit?: typeof defaultResolveCompletionLimit
  cleanupExpiredChatImages?: typeof defaultCleanupExpiredChatImages
  authUtils?: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
}

export class ChatRequestBuilder {
  private protectedBodyKeys = new Set(['model', 'messages', 'stream'])
  private forbiddenHeaderNames = new Set([
    'authorization',
    'proxy-authorization',
    'cookie',
    'set-cookie',
    'host',
    'connection',
    'transfer-encoding',
    'content-length',
    'accept-encoding',
  ])
  private prisma: PrismaClient
  private tokenizer: Pick<typeof Tokenizer, 'truncateMessages' | 'countConversationTokens'>
  private resolveContextLimit: typeof defaultResolveContextLimit
  private resolveCompletionLimit: typeof defaultResolveCompletionLimit
  private cleanupExpiredChatImages: typeof defaultCleanupExpiredChatImages
  private authUtils: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  private readonly defaultSessionPromptTemplate = '今天日期是{day time}'

  constructor(deps: ChatRequestBuilderDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.tokenizer = deps.tokenizer ?? Tokenizer
    this.resolveContextLimit = deps.resolveContextLimit ?? defaultResolveContextLimit
    this.resolveCompletionLimit = deps.resolveCompletionLimit ?? defaultResolveCompletionLimit
    this.cleanupExpiredChatImages = deps.cleanupExpiredChatImages ?? defaultCleanupExpiredChatImages
    this.authUtils = deps.authUtils ?? defaultAuthUtils
  }

  async prepare(params: PrepareChatRequestParams): Promise<PreparedChatRequest> {
    if (!params.session.connectionId || !params.session.connection || !params.session.modelRawId) {
      throw new Error('Chat session connection is not ready')
    }
    const contextEnabled = params.payload?.contextEnabled !== false
    const systemSettings = await this.loadSystemSettings()
    this.scheduleImageCleanup(systemSettings)

    const systemPrompts: Array<{ role: 'system'; content: string }> = []
    const now = new Date()
    const templateVariables = this.buildPromptVariables(now)
    const globalPrompt = (systemSettings.chat_system_prompt || '').toString().trim()
    const personalPrompt = (params.personalPrompt || '').toString().trim()
    const sessionPrompt = (params.session as any).systemPrompt
    const sessionPromptNormalized = typeof sessionPrompt === 'string' ? sessionPrompt.trim() : ''
    const primaryPrompt =
      this.applyPromptTemplate(sessionPromptNormalized, templateVariables) ||
      this.applyPromptTemplate(personalPrompt, templateVariables) ||
      this.applyPromptTemplate(globalPrompt, templateVariables) ||
      this.applyPromptTemplate(this.defaultSessionPromptTemplate, templateVariables)
    if (primaryPrompt) {
      systemPrompts.push({ role: 'system', content: primaryPrompt })
    }
    const extraPrompts = Array.isArray(params.extraSystemPrompts) ? params.extraSystemPrompts : []
    for (const item of extraPrompts) {
      const normalized = typeof item === 'string' ? item.trim() : ''
      if (!normalized) continue
      const templated = this.applyPromptTemplate(normalized, templateVariables)
      if (templated) {
        systemPrompts.push({ role: 'system', content: templated })
      }
    }

    const requestedSkills = normalizeRequestedSkills(params.payload?.skills)
    const enabledSkillSet = new Set(requestedSkills.enabled)

    if (enabledSkillSet.has(BUILTIN_SKILL_SLUGS.WEB_SEARCH)) {
      systemPrompts.push({
        role: 'system',
        content:
          '仅在需要最新信息时调用 web_search，且 query 必须包含明确关键词（如事件、日期、地点、人物或问题本身）。若无需搜索或无关键词，请直接回答，不要调用工具。若结果不足以回答，可以继续调用 web_search 直到信息充分或达到上限。若用户提供了明确 URL 并需要读取内容，请使用 read_url 获取网页正文。',
      })
    }
    if (enabledSkillSet.has(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER)) {
      systemPrompts.push({
        role: 'system',
        content:
          '你拥有会话级独立 workspace 工具链：python_runner、workspace_git_clone、workspace_list_files、workspace_read_text。生成可下载文件时请写入 /workspace/artifacts（例如 report.xlsx、report.pdf）。需要分析代码仓库时先用 workspace_git_clone 克隆到 /workspace/repos，再用 workspace_list_files / workspace_read_text 浏览。Python 运行在隔离沙箱中，优先使用简短、确定性代码，并通过 print() 输出关键信息。',
      })
    }

    systemPrompts.push({
      role: 'system',
      content:
        '输出请使用 Markdown 语法。若在表格单元格内列出多条内容，请使用 Markdown 列表或换行（例如以 "- " 或 "• " 开头），不要输出 HTML 列表标签（如 <li>/<ul>/<ol>）。',
    })

    // RAG 文档上下文增强
    if (params.ragContext && params.ragContext.trim()) {
      systemPrompts.push({
        role: 'system',
        content: params.ragContext.trim(),
      })
    }

    const contextInfo = await this.buildContextMessages({
      sessionId: params.session.id,
      connectionId: params.session.connectionId,
      modelRawId: params.session.modelRawId,
      provider: params.session.connection.provider as ProviderType,
      actorContent: params.content,
      contextEnabled,
      historyUpperBound: params.historyUpperBound ?? null,
      pinnedSystemMessages: systemPrompts,
    })

    const contextMessages = contextInfo.truncatedContext

    const messagesPayload = this.buildMessagesPayload(
      contextMessages,
      params.content,
      params.images ?? [],
    )

    const temperature = await this.resolveTemperature({
      connectionId: params.session.connectionId,
      rawModelId: params.session.modelRawId,
      systemSettings,
    })

    let baseRequestBody: any = {
      model: params.session.modelRawId,
      messages: messagesPayload,
      stream: params.mode === 'stream',
      temperature,
      max_tokens: contextInfo.appliedMaxTokens,
    }

    const reasoning = this.resolveReasoningOptions({
      payload: params.payload,
      session: params.session,
      settings: systemSettings,
    })

    this.applyReasoningOptions(baseRequestBody, reasoning)
    const customBodyResult = this.applyCustomBody(baseRequestBody, params.payload?.custom_body)
    baseRequestBody = customBodyResult.mergedBody

    const providerRequest = await this.buildProviderRequest({
      session: params.session,
      baseRequestBody,
      messagesPayload,
      systemSettings,
      mode: params.mode,
      customHeaders: params.payload?.custom_headers,
    })

    return {
      promptTokens: contextInfo.promptTokens,
      contextLimit: contextInfo.contextLimit,
      contextRemaining: contextInfo.contextRemaining,
      appliedMaxTokens: contextInfo.appliedMaxTokens,
      contextEnabled,
      systemSettings,
      providerRequest,
      messagesPayload,
      baseRequestBody: { ...baseRequestBody },
      reasoning,
    }
  }

  private async buildContextMessages(params: {
    sessionId: number
    connectionId: number
    modelRawId: string
    provider: ProviderType
    actorContent: string
    contextEnabled: boolean
    historyUpperBound: Date | null
    pinnedSystemMessages: Array<{ role: 'system'; content: string }>
  }) {
    const contextLimit = await this.resolveContextLimit({
      connectionId: params.connectionId,
      rawModelId: params.modelRawId,
      provider: params.provider,
    })

    const pinned = params.pinnedSystemMessages
    const pinnedTokens = pinned.length
      ? await this.tokenizer.countConversationTokens(pinned)
      : 0
    const remainingBudget = Math.max(0, contextLimit - pinnedTokens)

    let truncatedConversation: Array<{ role: string; content: string }>
    if (params.contextEnabled) {
      const recent = await this.prisma.message.findMany({
        where: {
          sessionId: params.sessionId,
          ...(params.historyUpperBound
            ? { createdAt: { lte: params.historyUpperBound } }
            : {}),
        },
        select: {
          role: true,
          content: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      const conversation = recent
        .filter((msg) => msg.role !== 'user' || msg.content !== params.actorContent)
        .reverse()
      const toTruncate = conversation.concat([{ role: 'user', content: params.actorContent }])
      truncatedConversation = await this.tokenizer.truncateMessages(
        toTruncate,
        Math.max(1, remainingBudget),
      )
    } else {
      truncatedConversation = [{ role: 'user', content: params.actorContent }]
    }

    const combined = [...pinned, ...truncatedConversation]
    const promptTokens = await this.tokenizer.countConversationTokens(combined)
    const contextRemaining = Math.max(0, contextLimit - promptTokens)
    const completionLimit = await this.resolveCompletionLimit({
      connectionId: params.connectionId,
      rawModelId: params.modelRawId,
      provider: params.provider,
    })
    const appliedMaxTokens = Math.max(
      1,
      Math.min(completionLimit || contextLimit, Math.max(1, contextRemaining)),
    )

    return {
      truncatedContext: combined,
      promptTokens,
      contextLimit,
      contextRemaining,
      appliedMaxTokens,
    }
  }

  private buildMessagesPayload(
    messages: Array<{ role: string; content: string }>,
    content: string,
    images: Array<{ data: string; mime: string }>,
  ) {
    const payload = messages.map((msg) => ({ role: msg.role, content: msg.content }))
    const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
    const text = content?.trim() || ''
    if (text) {
      parts.push({ type: 'text', text })
    }
    if (images && images.length) {
      for (const image of images) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${image.mime};base64,${image.data}` },
        })
      }
    }
    if (parts.length > 0) {
      const last = payload[payload.length - 1]
      if (last && last.role === 'user' && last.content === content) {
        payload[payload.length - 1] = { role: 'user', content: parts }
      } else {
        payload.push({ role: 'user', content: parts })
      }
    }
    return payload
  }

  private buildPromptVariables(now: Date) {
    const pad = (value: number) => value.toString().padStart(2, '0')
    const year = now.getFullYear()
    const month = pad(now.getMonth() + 1)
    const day = pad(now.getDate())
    const hour = pad(now.getHours())
    const minute = pad(now.getMinutes())
    const second = pad(now.getSeconds())
    const offsetMinutes = -now.getTimezoneOffset()
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const absMinutes = Math.abs(offsetMinutes)
    const offsetHours = pad(Math.floor(absMinutes / 60))
    const offsetRest = pad(absMinutes % 60)
    const timezoneOffset = `UTC${sign}${offsetHours}:${offsetRest}`
    const localTime = `${year}-${month}-${day} ${hour}:${minute}:${second}`
    const dayTimeValue = `${localTime} (${timezoneOffset})`
    return { 'day time': dayTimeValue }
  }

  private applyPromptTemplate(
    template: string | null | undefined,
    variables: Record<string, string>,
  ) {
    const normalized = (template || '').toString().trim()
    if (!normalized) return ''
    let result = normalized
    for (const [key, value] of Object.entries(variables)) {
      if (!key) continue
      const pattern = new RegExp(`\\{\\s*${key.replace(/\s+/g, '\\s+')}\\s*\\}`, 'gi')
      result = result.replace(pattern, value)
    }
    return result
  }

  private resolveReasoningOptions(params: {
    payload: SendMessagePayload
    session: ChatSessionWithConnection
    settings: Record<string, string>
  }) {
    const fallbackEnabled =
      (params.settings.reasoning_enabled ??
        (process.env.REASONING_ENABLED ?? 'true'))
        .toString()
        .toLowerCase() !== 'false'

    const enabled =
      typeof params.payload?.reasoningEnabled === 'boolean'
        ? params.payload.reasoningEnabled
        : params.session.reasoningEnabled ?? fallbackEnabled

    const effort = (
      params.payload?.reasoningEffort ||
      params.session.reasoningEffort ||
      params.settings.openai_reasoning_effort ||
      process.env.OPENAI_REASONING_EFFORT ||
      ''
    ).toString()

    const fallbackOllamaThink =
      (params.settings.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false'))
        .toString()
        .toLowerCase() === 'true'

    const ollamaThink =
      typeof params.payload?.ollamaThink === 'boolean'
        ? params.payload.ollamaThink
        : (params.session.ollamaThink ?? fallbackOllamaThink)

    return {
      enabled: Boolean(enabled),
      effort,
      ollamaThink: Boolean(ollamaThink),
    }
  }

  private applyReasoningOptions(body: any, reasoning: { enabled: boolean; effort: string; ollamaThink: boolean }) {
    delete body.reasoning_effort
    delete body.think
    if (reasoning.enabled && reasoning.effort) {
      body.reasoning_effort = reasoning.effort
    }
    if (reasoning.enabled && reasoning.ollamaThink) {
      body.think = true
    }
  }

  private async buildProviderRequest(params: {
    session: ChatSessionWithConnection
    baseRequestBody: any
    messagesPayload: any[]
    systemSettings: Record<string, string>
    mode: 'stream' | 'completion'
    customHeaders?: Array<{ name: string; value: string }>
  }) {
    const provider = params.session.connection.provider as ProviderType
    const baseUrl = params.session.connection.baseUrl.replace(/\/+$/, '')
    const extraHeaders = this.parseHeadersJson(params.session.connection.headersJson)
    const decryptedKey =
      params.session.connection.authType === 'bearer' && params.session.connection.apiKey
        ? this.authUtils.decryptApiKey(params.session.connection.apiKey)
        : undefined

    const providerHeaders = await buildHeaders(
      provider,
      params.session.connection.authType as AuthType,
      decryptedKey,
      extraHeaders,
    )
    const mergedHeaders = this.mergeCustomHeaders(providerHeaders, extraHeaders, params.customHeaders)

    const authHeader: Record<string, string> = {}
    for (const [key, value] of Object.entries(mergedHeaders)) {
      const lower = key.toLowerCase()
      if (lower === 'content-type') {
        continue
      }
      if (extraHeaders[key] !== undefined) {
        continue
      }
      authHeader[key] = value
    }

    const { url, body } = buildChatProviderRequest({
      provider,
      baseUrl,
      rawModelId: params.session.modelRawId!,
      body: params.baseRequestBody,
      azureApiVersion: params.session.connection.azureApiVersion,
      stream: params.mode === 'stream',
    })

    const timeoutMs = this.resolveProviderTimeout(params.systemSettings)

    return {
      providerLabel: provider,
      providerHost: this.safeResolveHost(baseUrl),
      baseUrl,
      rawModelId: params.session.modelRawId!,
      azureApiVersion: params.session.connection.azureApiVersion ?? null,
      url,
      headers: mergedHeaders,
      authHeader,
      extraHeaders,
      body,
      timeoutMs,
    }
  }

  private applyCustomBody(
    base: Record<string, any>,
    custom?: Record<string, any>,
  ): { mergedBody: Record<string, any>; blockedKeys: string[] } {
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) {
      return { mergedBody: base, blockedKeys: [] }
    }
    const blocked: string[] = []
    const mergeObject = (
      target: Record<string, any>,
      source: Record<string, any>,
      path: string,
    ) => {
      for (const [key, value] of Object.entries(source)) {
        const nextPath = path ? `${path}.${key}` : key
        if (this.protectedBodyKeys.has(key)) {
          blocked.push(nextPath)
          continue
        }
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          typeof target[key] === 'object' &&
          target[key] !== null &&
          !Array.isArray(target[key])
        ) {
          target[key] = mergeObject({ ...(target[key] as Record<string, any>) }, value, nextPath)
        } else {
          target[key] = value
        }
      }
      return target
    }

    return {
      mergedBody: mergeObject({ ...base }, custom, ''),
      blockedKeys: blocked,
    }
  }

  private mergeCustomHeaders(
    providerHeaders: Record<string, string>,
    extraHeaders: Record<string, string>,
    customHeaders?: Array<{ name: string; value: string }>,
  ): Record<string, string> {
    if (!customHeaders || customHeaders.length === 0) {
      return providerHeaders
    }
    const merged: Record<string, string> = { ...providerHeaders }
    for (const header of customHeaders) {
      const name = (header?.name || '').trim()
      const value = (header?.value || '').trim()
      if (!name || !value) {
        continue
      }
      const lower = name.toLowerCase()
      if (this.forbiddenHeaderNames.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
        continue
      }
      const headerExists = Object.keys(extraHeaders).some((k) => k.toLowerCase() === lower)
      if (headerExists) {
        continue
      }
      const mergedHasSame = Object.keys(merged).some((k) => k.toLowerCase() === lower)
      if (mergedHasSame) {
        continue
      }
      merged[name] = value
    }
    return merged
  }

  private async loadSystemSettings(): Promise<Record<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
      select: { key: true, value: true },
    })
    return rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.key] = row.value ?? ''
      return acc
    }, {})
  }

  private async resolveTemperature(params: {
    connectionId: number
    rawModelId: string
    systemSettings: Record<string, string>
  }): Promise<number> {
    const { connectionId, rawModelId, systemSettings } = params
    const catalog = await this.prisma.modelCatalog.findFirst({
      where: { connectionId, rawId: rawModelId },
      select: { metaJson: true },
    })
    const modelOverride = this.parseTemperatureValue(catalog?.metaJson)
    if (modelOverride !== null) {
      return modelOverride
    }
    const systemDefault = this.parseTemperatureValue(systemSettings.temperature_default)
    if (systemDefault !== null) {
      return systemDefault
    }
    return 0.7
  }

  private parseTemperatureValue(raw: unknown): number | null {
    if (raw == null || raw === '') return null
    let value: unknown = raw
    if (typeof raw === 'string') {
      try {
        const parsedJson = JSON.parse(raw)
        if (parsedJson && typeof parsedJson === 'object' && 'temperature' in (parsedJson as any)) {
          value = (parsedJson as any).temperature
        }
      } catch {
        value = raw
      }
    }
    const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 2) return null
    return numeric
  }

  private scheduleImageCleanup(settings: Record<string, string>) {
    const raw =
      settings.chat_image_retention_days ||
      process.env.CHAT_IMAGE_RETENTION_DAYS ||
      `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`
    const parsed = Number.parseInt(raw, 10)
    const retention = Number.isFinite(parsed) ? parsed : CHAT_IMAGE_DEFAULT_RETENTION_DAYS
    this.cleanupExpiredChatImages(retention).catch((error) => {
      console.warn('[chat] cleanupExpiredChatImages failed', {
        error: error instanceof Error ? error.message : error,
      })
    })
  }

  private resolveProviderTimeout(settings: Record<string, string>) {
    const raw = settings.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000'
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
    return 300000
  }

  private safeResolveHost(baseUrl: string): string | null {
    try {
      const parsed = new URL(baseUrl)
      return parsed.hostname
    } catch {
      return null
    }
  }

  private parseHeadersJson(raw?: string | null): Record<string, string> {
    if (!raw) return {}
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, String(value)]),
        )
      }
    } catch {}
    return {}
  }
}

export const chatRequestBuilder = new ChatRequestBuilder()
