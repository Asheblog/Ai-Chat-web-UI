import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../../db'
import { Tokenizer } from '../../../utils/tokenizer'
import { resolveContextLimit as defaultResolveContextLimit } from '../../../utils/context-window'
import { AuthUtils as defaultAuthUtils } from '../../../utils/auth'
import {
  buildHeaders,
  type AuthType,
  type ProviderType,
} from '../../../utils/providers'
import { buildChatProviderRequest } from '../../../utils/chat-provider'
import { extractTextFromResponsesResponse } from '../../../utils/openai-responses'
import { BackendLogger as log } from '../../../utils/logger'

type ChatSessionWithConnection = Prisma.ChatSessionGetPayload<{ include: { connection: true } }>

type PlainMessage = {
  id: number
  role: string
  content: string
  createdAt: Date
}

export interface CompressionAppliedPayload {
  groupId: number
  compressedCount: number
  thresholdTokens: number
  beforeTokens: number
  afterTokens: number
  tailMessages: number
}

export interface CompressionAttemptResult {
  applied: boolean
  payload?: CompressionAppliedPayload
  reason?: string
}

export interface CompressionCandidateSummary {
  id: number
  role: string
  content: string
  createdAt: string
}

export interface ConversationCompressionServiceDeps {
  prisma?: PrismaClient
  resolveContextLimit?: typeof defaultResolveContextLimit
  authUtils?: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  fetchFn?: typeof fetch
}

const DEFAULT_THRESHOLD_RATIO = 0.5
const DEFAULT_TAIL_MESSAGES = 12
const MIN_MESSAGES_TO_COMPRESS = 4
const MIN_CONTEXT_WINDOW = 1024

export class ConversationCompressionService {
  private prisma: PrismaClient
  private resolveContextLimit: typeof defaultResolveContextLimit
  private authUtils: Pick<typeof defaultAuthUtils, 'decryptApiKey'>
  private fetchFn: typeof fetch

  constructor(deps: ConversationCompressionServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.resolveContextLimit = deps.resolveContextLimit ?? defaultResolveContextLimit
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.fetchFn = deps.fetchFn ?? fetch
  }

  async compressIfNeeded(params: {
    session: ChatSessionWithConnection
    actorContent: string
    protectedMessageId?: number | null
    historyUpperBound?: Date | null
  }): Promise<CompressionAttemptResult> {
    if (!params.session.connectionId || !params.session.connection || !params.session.modelRawId) {
      return { applied: false, reason: 'session_model_missing' }
    }

    const settings = await this.loadSystemSettings()
    const enabled = this.parseBoolean(settings.context_compression_enabled, true)
    if (!enabled) {
      return { applied: false, reason: 'disabled' }
    }

    const thresholdRatio = this.parseFloatInRange(
      settings.context_compression_threshold_ratio,
      DEFAULT_THRESHOLD_RATIO,
      0.2,
      0.9,
    )
    const tailMessages = this.parseIntInRange(
      settings.context_compression_tail_messages,
      DEFAULT_TAIL_MESSAGES,
      4,
      50,
    )

    const contextLimitRaw = await this.resolveContextLimit({
      connectionId: params.session.connectionId,
      rawModelId: params.session.modelRawId,
      provider: params.session.connection.provider as ProviderType,
    })
    const contextLimit = Number.isFinite(contextLimitRaw) && contextLimitRaw > 0
      ? contextLimitRaw
      : MIN_CONTEXT_WINDOW
    const thresholdTokens = Math.max(1, Math.floor(contextLimit * thresholdRatio))

    const whereClause: Record<string, unknown> = {
      sessionId: params.session.id,
      messageGroupId: null,
      ...(params.historyUpperBound ? { createdAt: { lte: params.historyUpperBound } } : {}),
    }

    const ungroupedMessages = (await (this.prisma as any).message.findMany({
      where: whereClause,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as PlainMessage[]

    if (ungroupedMessages.length < tailMessages + MIN_MESSAGES_TO_COMPRESS) {
      return { applied: false, reason: 'not_enough_messages' }
    }

    const baseConversation = ungroupedMessages.map((msg) => ({ role: msg.role, content: msg.content }))
    const beforeTokens = await Tokenizer.countConversationTokens(baseConversation)
    if (beforeTokens <= thresholdTokens) {
      return { applied: false, reason: 'below_threshold' }
    }

    const protectedIds = new Set<number>()
    for (const message of ungroupedMessages.slice(-tailMessages)) {
      protectedIds.add(message.id)
    }
    if (typeof params.protectedMessageId === 'number' && Number.isFinite(params.protectedMessageId)) {
      protectedIds.add(params.protectedMessageId)
    }

    const candidates = ungroupedMessages.filter((msg) => !protectedIds.has(msg.id))
    if (candidates.length < MIN_MESSAGES_TO_COMPRESS) {
      return { applied: false, reason: 'candidate_too_small' }
    }

    const candidateConversation = candidates.map((msg) => ({ role: msg.role, content: msg.content }))
    const summaryInputBudget = Math.max(
      512,
      Math.floor(Math.max(MIN_CONTEXT_WINDOW, contextLimit) * 0.6),
    )
    const summaryInputMessages = await Tokenizer.truncateMessages(candidateConversation, summaryInputBudget)

    if (summaryInputMessages.length < 2) {
      return { applied: false, reason: 'summary_input_too_small' }
    }

    const summary = await this.generateSummary({
      session: params.session,
      messages: summaryInputMessages,
      actorContent: params.actorContent,
      timeoutMs: this.parseIntInRange(settings.provider_timeout_ms, 300000, 10000, 3600000),
    })

    const normalizedSummary = summary.trim()
    if (!normalizedSummary) {
      return { applied: false, reason: 'summary_empty' }
    }

    const candidateIds = candidates.map((msg) => msg.id)
    const compressedMessages: CompressionCandidateSummary[] = candidates.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
    }))

    const metadata = {
      source: 'auto',
      thresholdRatio,
      thresholdTokens,
      beforeTokens,
      tailMessages,
      compressedCount: candidates.length,
      contextLimit,
    }

    const txResult = await this.prisma.$transaction(async (tx) => {
      const group = await (tx as any).messageGroup.create({
        data: {
          sessionId: params.session.id,
          type: 'compression',
          summary: normalizedSummary,
          compressedMessagesJson: JSON.stringify(compressedMessages),
          startMessageId: candidates[0]?.id ?? null,
          endMessageId: candidates[candidates.length - 1]?.id ?? null,
          lastMessageId: candidates[candidates.length - 1]?.id ?? null,
          expanded: false,
          metadataJson: JSON.stringify(metadata),
        },
        select: { id: true },
      })

      const updated = await (tx as any).message.updateMany({
        where: {
          sessionId: params.session.id,
          id: { in: candidateIds },
          messageGroupId: null,
        },
        data: {
          messageGroupId: group.id,
        },
      })
      if (Number(updated?.count || 0) === 0) {
        throw new Error('compression_race_conflict')
      }

      return group
    })

    const [candidateTokens, summaryTokens] = await Promise.all([
      Tokenizer.countConversationTokens(candidateConversation),
      Tokenizer.countConversationTokens([{ role: 'system', content: this.formatSummaryMessage(normalizedSummary, candidates.length) }]),
    ])

    const afterTokens = Math.max(1, beforeTokens - candidateTokens + summaryTokens)

    return {
      applied: true,
      payload: {
        groupId: Number(txResult.id),
        compressedCount: candidates.length,
        thresholdTokens,
        beforeTokens,
        afterTokens,
        tailMessages,
      },
    }
  }

  async updateGroupExpanded(params: {
    sessionId: number
    groupId: number
    expanded: boolean
  }): Promise<boolean> {
    const updated = await (this.prisma as any).messageGroup.updateMany({
      where: {
        id: params.groupId,
        sessionId: params.sessionId,
        cancelledAt: null,
      },
      data: {
        expanded: params.expanded,
      },
    })
    return Number(updated?.count || 0) > 0
  }

  async cancelGroup(params: {
    sessionId: number
    groupId: number
  }): Promise<{ cancelled: boolean; releasedCount: number }> {
    const target = await (this.prisma as any).messageGroup.findFirst({
      where: {
        id: params.groupId,
        sessionId: params.sessionId,
        cancelledAt: null,
      },
      select: { id: true },
    })

    if (!target) {
      return { cancelled: false, releasedCount: 0 }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const released = await (tx as any).message.updateMany({
        where: {
          sessionId: params.sessionId,
          messageGroupId: params.groupId,
        },
        data: {
          messageGroupId: null,
        },
      })

      await (tx as any).messageGroup.update({
        where: { id: params.groupId },
        data: {
          cancelledAt: new Date(),
          expanded: false,
        },
      })

      return Number(released?.count || 0)
    })

    return {
      cancelled: true,
      releasedCount: result,
    }
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

  private parseBoolean(raw: unknown, fallback: boolean) {
    if (typeof raw === 'boolean') return raw
    if (typeof raw === 'string') {
      const normalized = raw.trim().toLowerCase()
      if (normalized === 'true' || normalized === '1') return true
      if (normalized === 'false' || normalized === '0') return false
    }
    return fallback
  }

  private parseIntInRange(raw: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseInt(String(raw ?? ''), 10)
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed))
    }
    return fallback
  }

  private parseFloatInRange(raw: unknown, fallback: number, min: number, max: number) {
    const parsed = Number.parseFloat(String(raw ?? ''))
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed))
    }
    return fallback
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

  private formatSummaryMessage(summary: string, compressedCount: number) {
    const safeCount = Math.max(1, compressedCount)
    return `[历史对话压缩摘要，共 ${safeCount} 条消息]\n${summary}`
  }

  private formatSummaryInput(messages: Array<{ role: string; content: string }>) {
    const MAX_LINE_LENGTH = 1600
    return messages
      .map((msg, index) => {
        const role = msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : 'other'
        const normalized = (msg.content || '').replace(/\s+/g, ' ').trim()
        const content = normalized.length > MAX_LINE_LENGTH
          ? `${normalized.slice(0, MAX_LINE_LENGTH)}...`
          : normalized
        return `${index + 1}. [${role}] ${content || '(空内容)'}`
      })
      .join('\n')
  }

  private fallbackSummary(messages: Array<{ role: string; content: string }>) {
    const userMessages = messages
      .filter((msg) => msg.role === 'user')
      .map((msg) => msg.content.trim())
      .filter(Boolean)
    const assistantMessages = messages
      .filter((msg) => msg.role === 'assistant')
      .map((msg) => msg.content.trim())
      .filter(Boolean)

    const userHead = userMessages.slice(0, 2).map((item) => `- ${item.slice(0, 80)}`).join('\n')
    const userTail = userMessages.slice(-2).map((item) => `- ${item.slice(0, 80)}`).join('\n')
    const assistantTail = assistantMessages.slice(-2).map((item) => `- ${item.slice(0, 80)}`).join('\n')

    const blocks = [
      '用户主要问题：',
      userHead || '- （无）',
      '近期用户关注：',
      userTail || '- （无）',
      '近期助手结论：',
      assistantTail || '- （无）',
    ]

    return blocks.join('\n')
  }

  private async generateSummary(params: {
    session: ChatSessionWithConnection
    messages: Array<{ role: string; content: string }>
    actorContent: string
    timeoutMs: number
  }): Promise<string> {
    const provider = params.session.connection?.provider as ProviderType
    const baseUrl = (params.session.connection?.baseUrl || '').replace(/\/+$/, '')
    const rawModelId = params.session.modelRawId || ''
    const authType = (params.session.connection?.authType || 'none') as AuthType

    if (!provider || !baseUrl || !rawModelId) {
      return this.fallbackSummary(params.messages)
    }

    const systemPrompt = [
      '你是对话上下文压缩器。',
      '请把历史对话压缩成可持续复用的记忆摘要。',
      '输出要求：',
      '1) 只输出摘要正文，不要前后缀。',
      '2) 保留用户目标、约束、已确认事实、待办和未决问题。',
      '3) 不要臆测，不要新增事实。',
      '4) 控制在 200~600 字。',
    ].join('\n')

    const userPrompt = [
      '以下是需要压缩的历史消息：',
      this.formatSummaryInput(params.messages),
      '',
      `最新用户输入（供你判断上下文连续性）：${(params.actorContent || '').trim() || '(空)'}`,
    ].join('\n')

    const body = {
      model: rawModelId,
      stream: false,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }

    const request = buildChatProviderRequest({
      provider,
      baseUrl,
      rawModelId,
      azureApiVersion: params.session.connection?.azureApiVersion,
      body,
      stream: false,
    })

    const headers = await buildHeaders(
      provider,
      authType,
      this.authUtils.decryptApiKey(params.session.connection?.apiKey || ''),
      this.parseHeadersJson(params.session.connection?.headersJson),
    )

    try {
      const response = await this.fetchFn(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(Math.max(10000, params.timeoutMs)),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        log.warn('[context-compression] provider summary request failed', {
          sessionId: params.session.id,
          status: response.status,
          provider,
          error: errorText.slice(0, 200),
        })
        return this.fallbackSummary(params.messages)
      }

      const raw = await response.text()
      let json: any = null
      try {
        json = JSON.parse(raw)
      } catch {
        return this.fallbackSummary(params.messages)
      }

      const summary = provider === 'openai_responses'
        ? extractTextFromResponsesResponse(json)
        : json?.choices?.[0]?.message?.content || json?.message?.content || ''

      if (typeof summary === 'string' && summary.trim().length > 0) {
        return summary.trim()
      }
      return this.fallbackSummary(params.messages)
    } catch (error) {
      log.warn('[context-compression] provider summary request threw error', {
        sessionId: params.session.id,
        provider,
        error: error instanceof Error ? error.message : String(error),
      })
      return this.fallbackSummary(params.messages)
    }
  }
}

export const conversationCompressionService = new ConversationCompressionService()
