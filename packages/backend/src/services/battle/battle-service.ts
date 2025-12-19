import crypto from 'node:crypto'
import type { Prisma, PrismaClient, Connection } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import type { ModelResolverService } from '../catalog/model-resolver-service'
import { modelResolverService as defaultModelResolverService } from '../catalog/model-resolver-service'
import type { ChatRequestBuilder, PreparedChatRequest } from '../../modules/chat/services/chat-request-builder'
import { chatRequestBuilder as defaultChatRequestBuilder } from '../../modules/chat/services/chat-request-builder'
import type { ProviderRequester } from '../../modules/chat/services/provider-requester'
import { providerRequester as defaultProviderRequester } from '../../modules/chat/services/provider-requester'
import { convertOpenAIReasoningPayload } from '../../utils/providers'
import { buildAgentPythonToolConfig, buildAgentWebSearchConfig } from '../../modules/chat/agent-tool-config'
import { WebSearchToolHandler } from '../../modules/chat/tool-handlers/web-search-handler'
import { PythonToolHandler } from '../../modules/chat/tool-handlers/python-handler'
import type { ToolCall, ToolHandlerResult } from '../../modules/chat/tool-handlers/types'
import { consumeActorQuota } from '../../utils/quota'

export type BattleRunStatus = 'pending' | 'running' | 'completed' | 'error'

export type BattleModelFeatures = {
  web_search?: boolean
  web_search_scope?: 'webpage' | 'document' | 'paper' | 'image' | 'video' | 'podcast'
  web_search_include_summary?: boolean
  web_search_include_raw?: boolean
  web_search_size?: number
  python_tool?: boolean
}

export type BattleModelInput = {
  modelId: string
  connectionId?: number
  rawId?: string
  features?: BattleModelFeatures
  custom_body?: Record<string, any>
  custom_headers?: Array<{ name: string; value: string }>
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  ollamaThink?: boolean
}

export type BattleJudgeInput = {
  modelId: string
  connectionId?: number
  rawId?: string
}

export interface BattleRunCreateInput {
  title?: string
  prompt: string
  expectedAnswer: string
  judge: BattleJudgeInput
  judgeThreshold?: number
  runsPerModel: number
  passK: number
  models: BattleModelInput[]
  maxConcurrency?: number
}

export interface BattleRunSummary {
  totalModels: number
  runsPerModel: number
  passK: number
  judgeThreshold: number
  passModelCount: number
  accuracy: number
  modelStats: Array<{
    modelId: string
    connectionId: number | null
    rawId: string | null
    passAtK: boolean
    passCount: number
    accuracy: number
  }>
}

export interface BattleRunConfigModel {
  modelId: string
  connectionId: number | null
  rawId: string | null
}

export interface BattleRunConfig {
  models: BattleRunConfigModel[]
}

export interface BattleResultRecord {
  id: number
  battleRunId: number
  modelId: string
  connectionId: number | null
  rawId: string | null
  attemptIndex: number
  output: string
  usageJson: string
  durationMs: number | null
  error: string | null
  judgePass: boolean | null
  judgeScore: number | null
  judgeReason: string | null
  judgeFallbackUsed: boolean
}

export interface BattleRunRecord {
  id: number
  title: string
  prompt: string
  expectedAnswer: string
  judgeModelId: string
  judgeConnectionId: number | null
  judgeRawId: string | null
  judgeThreshold: number
  runsPerModel: number
  passK: number
  status: BattleRunStatus
  configJson: string
  summaryJson: string
  createdAt: Date
  updatedAt: Date
}

export interface BattleShareDetail {
  id: number
  battleRunId: number
  token: string
  title: string
  payload: BattleSharePayload
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface BattleSharePayload {
  title: string
  prompt: string
  expectedAnswer: string
  judge: {
    modelId: string
    modelLabel: string | null
    threshold: number
  }
  summary: BattleRunSummary
  results: Array<{
    modelId: string
    modelLabel: string | null
    connectionId: number | null
    rawId: string | null
    attemptIndex: number
    output: string
    durationMs: number | null
    error: string | null
    usage: Record<string, any>
    judgePass: boolean | null
    judgeScore: number | null
    judgeReason: string | null
    judgeFallbackUsed: boolean
  }>
  createdAt: string
}

export interface BattleExecutionEvent {
  type: 'run_start' | 'attempt_start' | 'attempt_complete' | 'run_complete' | 'error'
  payload: Record<string, unknown>
}

export interface BattleServiceDeps {
  prisma?: PrismaClient
  modelResolver?: ModelResolverService
  requestBuilder?: ChatRequestBuilder
  requester?: ProviderRequester
  logger?: Pick<typeof console, 'warn' | 'error'>
}

const DEFAULT_JUDGE_THRESHOLD = 0.8

const toISOStringSafe = (value: Date | string | null | undefined) => {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const sanitizeHeaders = (headers?: Array<{ name: string; value: string }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({ name: (item?.name || '').trim() }))
    .filter((item) => item.name.length > 0)
}

const summarizeCustomBody = (body?: Record<string, any>) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { keys: [] as string[] }
  }
  const keys = Object.keys(body).slice(0, 20)
  return { keys }
}

const safeJsonStringify = (value: unknown, fallback: string) => {
  try {
    return JSON.stringify(value)
  } catch {
    return fallback
  }
}

const safeParseJson = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const normalizeSummary = (
  raw: unknown,
  defaults: { runsPerModel: number; passK: number; judgeThreshold: number },
): BattleRunSummary => {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const rawStats = Array.isArray(data.modelStats) ? data.modelStats : []
  const modelStats = rawStats
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const modelId = typeof item.modelId === 'string' ? item.modelId : ''
      if (!modelId) return null
      const accuracy = isFiniteNumber(item.accuracy) ? clamp(item.accuracy, 0, 1) : 0
      return {
        modelId,
        connectionId: isFiniteNumber(item.connectionId) ? item.connectionId : null,
        rawId: typeof item.rawId === 'string' && item.rawId.trim().length > 0 ? item.rawId : null,
        passAtK: Boolean(item.passAtK),
        passCount: isFiniteNumber(item.passCount) ? item.passCount : 0,
        accuracy,
      }
    })
    .filter((item): item is BattleRunSummary['modelStats'][number] => Boolean(item))

  const runsPerModel = isFiniteNumber(data.runsPerModel) ? data.runsPerModel : defaults.runsPerModel
  const passK = isFiniteNumber(data.passK) ? data.passK : defaults.passK
  const judgeThreshold = isFiniteNumber(data.judgeThreshold)
    ? clamp(data.judgeThreshold, 0, 1)
    : defaults.judgeThreshold
  const totalModels = isFiniteNumber(data.totalModels) ? data.totalModels : modelStats.length
  const passModelCount = isFiniteNumber(data.passModelCount)
    ? data.passModelCount
    : modelStats.filter((item) => item.passAtK).length
  const accuracy = isFiniteNumber(data.accuracy)
    ? data.accuracy
    : totalModels > 0
      ? passModelCount / totalModels
      : 0

  return {
    totalModels,
    runsPerModel,
    passK,
    judgeThreshold,
    passModelCount,
    accuracy: clamp(accuracy, 0, 1),
    modelStats,
  }
}

const normalizeConfigModels = (raw: unknown): BattleRunConfigModel[] => {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const rawModels = Array.isArray(data.models) ? data.models : []
  return rawModels
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : ''
      if (!modelId) return null
      return {
        modelId,
        connectionId: isFiniteNumber(item.connectionId) ? item.connectionId : null,
        rawId: typeof item.rawId === 'string' && item.rawId.trim().length > 0 ? item.rawId.trim() : null,
      }
    })
    .filter((item): item is BattleRunConfigModel => Boolean(item))
}

const buildRunTitle = (prompt: string, explicit?: string) => {
  const trimmed = (explicit || '').trim()
  if (trimmed) return trimmed
  const base = (prompt || '').trim()
  if (!base) return '模型大乱斗'
  return base.length > 30 ? `${base.slice(0, 30)}…` : base
}

const composeModelLabel = (connection: Connection | null, rawId?: string | null, fallback?: string | null) => {
  const raw = (rawId || '').trim()
  const prefix = (connection?.prefixId || '').trim()
  if (raw && prefix) return `${prefix}.${raw}`
  if (raw) return raw
  return fallback || null
}

const extractJsonObject = (raw: string) => {
  const fenced = raw.match(/```(?:json)?([\s\S]*?)```/i)
  const source = (fenced?.[1] || raw || '').trim()
  const match = source.match(/\{[\s\S]*\}/)
  if (!match) {
    throw new Error('Judge JSON not found')
  }
  return match[0]
}

const normalizeJudgeScore = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  let score = value
  if (score > 1 && score <= 100) {
    score = score / 100
  }
  return clamp(score, 0, 1)
}

const resolveMaxToolIterations = (sysMap: Record<string, string>) => {
  const raw = sysMap.agent_max_tool_iterations || process.env.AGENT_MAX_TOOL_ITERATIONS || '4'
  const parsed = Number.parseInt(String(raw), 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(20, parsed)
  }
  return 4
}

const buildUsage = (json: any, context: { promptTokens: number; contextLimit: number; contextRemaining: number }) => {
  const u = json?.usage || {}
  const promptTokens =
    Number(u?.prompt_tokens ?? u?.prompt_eval_count ?? u?.input_tokens ?? context.promptTokens) ||
    context.promptTokens
  const completionTokens =
    Number(u?.completion_tokens ?? u?.eval_count ?? u?.output_tokens ?? 0) || 0
  const totalTokens =
    Number(u?.total_tokens ?? 0) || promptTokens + (Number(u?.completion_tokens ?? 0) || 0)
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    context_limit: context.contextLimit,
    context_remaining: context.contextRemaining,
  }
}

export class BattleService {
  private prisma: PrismaClient
  private modelResolver: ModelResolverService
  private requestBuilder: ChatRequestBuilder
  private requester: ProviderRequester
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: BattleServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.modelResolver = deps.modelResolver ?? defaultModelResolverService
    this.requestBuilder = deps.requestBuilder ?? defaultChatRequestBuilder
    this.requester = deps.requester ?? defaultProviderRequester
    this.logger = deps.logger ?? console
  }

  async listRuns(actor: Actor, params?: { page?: number; limit?: number }) {
    const { page, limit } = this.normalizePagination(params)
    const where = this.buildOwnershipWhere(actor)
    const [rows, total] = await Promise.all([
      this.prisma.battleRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.battleRun.count({ where }),
    ])
    const data = rows.map((row) => this.serializeRunSummary(row))
    return {
      runs: data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async getRun(actor: Actor, runId: number) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      return null
    }
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const rawConfig = safeParseJson<Record<string, any>>(run.configJson, {})
    const configModels = normalizeConfigModels(rawConfig)
    const fallbackModels = new Map<string, BattleRunConfigModel>()
    for (const item of results) {
      const key = `${item.modelId}:${item.connectionId ?? 'null'}:${item.rawId ?? 'null'}`
      if (fallbackModels.has(key)) continue
      fallbackModels.set(key, {
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
      })
    }
    const config: BattleRunConfig = {
      models: configModels.length > 0 ? configModels : Array.from(fallbackModels.values()),
    }
    const connectionIds = Array.from(
      new Set(
        results
          .map((item) => item.connectionId)
          .filter((value): value is number => typeof value === 'number'),
      ),
    )
    const connections = connectionIds.length > 0
      ? await this.prisma.connection.findMany({
        where: { id: { in: connectionIds } },
        select: { id: true, prefixId: true },
      })
      : []
    const connectionMap = new Map(connections.map((c) => [c.id, c]))
    const judgeConnection = run.judgeConnectionId
      ? await this.prisma.connection.findFirst({
        where: { id: run.judgeConnectionId },
        select: { id: true, prefixId: true },
      })
      : null

    const rawSummary = safeParseJson<Record<string, any>>(run.summaryJson, {})
    let summary = normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })
    const shouldRebuildSummary =
      results.length > 0 && (summary.modelStats.length === 0 || summary.totalModels === 0)
    if (shouldRebuildSummary) {
      summary = this.buildSummary(results as BattleResultRecord[], run.runsPerModel, run.passK, run.judgeThreshold)
      if (run.status === 'completed') {
        await this.prisma.battleRun.update({
          where: { id: run.id },
          data: { summaryJson: safeJsonStringify(summary, '{}') },
        })
      }
    }

    return {
      ...this.serializeRunSummary(run),
      judgeModelLabel: composeModelLabel(judgeConnection, run.judgeRawId, run.judgeModelId),
      config,
      summary,
      results: results.map((item) => ({
        id: item.id,
        battleRunId: item.battleRunId,
        modelId: item.modelId,
        connectionId: item.connectionId,
        rawId: item.rawId,
        modelLabel: composeModelLabel(connectionMap.get(item.connectionId || -1) || null, item.rawId, item.modelId),
        attemptIndex: item.attemptIndex,
        output: item.output,
        usage: safeParseJson(item.usageJson, {} as Record<string, any>),
        durationMs: item.durationMs,
        error: item.error,
        judgePass: item.judgePass,
        judgeScore: item.judgeScore,
        judgeReason: item.judgeReason,
        judgeFallbackUsed: item.judgeFallbackUsed,
      })),
    }
  }

  async deleteRun(actor: Actor, runId: number) {
    const existing = await this.prisma.battleRun.findFirst({
      where: { id: runId, ...this.buildOwnershipWhere(actor) },
      select: { id: true },
    })
    if (!existing) return false
    await this.prisma.battleRun.delete({ where: { id: runId } })
    return true
  }

  async createShare(
    actor: Actor,
    params: { runId: number; title?: string | null; expiresInHours?: number | null },
  ): Promise<BattleShareDetail> {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: params.runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const connectionIds = Array.from(
      new Set(
        results
          .map((item) => item.connectionId)
          .filter((value): value is number => typeof value === 'number'),
      ),
    )
    const connections = connectionIds.length > 0
      ? await this.prisma.connection.findMany({
        where: { id: { in: connectionIds } },
        select: { id: true, prefixId: true },
      })
      : []
    const connectionMap = new Map(connections.map((c) => [c.id, c]))
    const judgeConnection = run.judgeConnectionId
      ? await this.prisma.connection.findFirst({
        where: { id: run.judgeConnectionId },
        select: { id: true, prefixId: true },
      })
      : null

    const rawSummary = safeParseJson<Record<string, any>>(run.summaryJson, {})
    let summary = normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })
    const shouldRebuildSummary =
      results.length > 0 && (summary.modelStats.length === 0 || summary.totalModels === 0)
    if (shouldRebuildSummary) {
      summary = this.buildSummary(results as BattleResultRecord[], run.runsPerModel, run.passK, run.judgeThreshold)
      if (run.status === 'completed') {
        await this.prisma.battleRun.update({
          where: { id: run.id },
          data: { summaryJson: safeJsonStringify(summary, '{}') },
        })
      }
    }

    const payload: BattleSharePayload = {
      title: run.title,
      prompt: run.prompt,
      expectedAnswer: run.expectedAnswer,
      judge: {
        modelId: run.judgeModelId,
        modelLabel: composeModelLabel(judgeConnection, run.judgeRawId, run.judgeModelId),
        threshold: run.judgeThreshold,
      },
      summary,
      results: results.map((item) => ({
        modelId: item.modelId,
        modelLabel: composeModelLabel(connectionMap.get(item.connectionId || -1) || null, item.rawId, item.modelId),
        connectionId: item.connectionId,
        rawId: item.rawId,
        attemptIndex: item.attemptIndex,
        output: item.output,
        durationMs: item.durationMs,
        error: item.error,
        usage: safeParseJson(item.usageJson, {} as Record<string, any>),
        judgePass: item.judgePass,
        judgeScore: item.judgeScore,
        judgeReason: item.judgeReason,
        judgeFallbackUsed: item.judgeFallbackUsed,
      })),
      createdAt: run.createdAt.toISOString(),
    }

    const token = await this.generateToken()
    const expiresAt = this.computeExpiry(params.expiresInHours)
    const title = (params.title || '').trim() || run.title

    const record = await this.prisma.battleShare.create({
      data: {
        battleRunId: run.id,
        token,
        title,
        payloadJson: safeJsonStringify(payload, '{}'),
        createdByUserId: actor.type === 'user' ? actor.id : null,
        createdByAnonymousKey: actor.type === 'anonymous' ? actor.key : null,
        expiresAt,
      },
    })

    return {
      id: record.id,
      battleRunId: run.id,
      token,
      title,
      payload,
      createdAt: record.createdAt.toISOString(),
      expiresAt: toISOStringSafe(record.expiresAt),
      revokedAt: toISOStringSafe(record.revokedAt),
    }
  }

  async getShareByToken(token: string): Promise<BattleShareDetail | null> {
    const record = await this.prisma.battleShare.findFirst({
      where: {
        token,
        revokedAt: null,
      },
    })
    if (!record) return null
    const now = new Date()
    if (record.expiresAt && record.expiresAt <= now) {
      return null
    }
    const payload = safeParseJson<BattleSharePayload>(record.payloadJson, null as any)
    if (!payload) return null
    return {
      id: record.id,
      battleRunId: record.battleRunId,
      token: record.token,
      title: record.title,
      payload,
      createdAt: record.createdAt.toISOString(),
      expiresAt: toISOStringSafe(record.expiresAt),
      revokedAt: toISOStringSafe(record.revokedAt),
    }
  }

  async executeRun(
    actor: Actor,
    input: BattleRunCreateInput,
    options?: { emitEvent?: (event: BattleExecutionEvent) => void },
  ) {
    const title = buildRunTitle(input.prompt, input.title)
    const judgeThreshold = this.normalizeJudgeThreshold(input.judgeThreshold)

    const configPayload = {
      runsPerModel: input.runsPerModel,
      passK: input.passK,
      judgeThreshold,
      models: input.models.map((model) => ({
        modelId: model.modelId,
        connectionId: model.connectionId ?? null,
        rawId: model.rawId ?? null,
        features: model.features ?? {},
        customHeaders: sanitizeHeaders(model.custom_headers),
        customBody: summarizeCustomBody(model.custom_body),
      })),
    }

    const run = await this.prisma.battleRun.create({
      data: {
        ...(actor.type === 'user' ? { userId: actor.id } : {}),
        ...(actor.type === 'anonymous' ? { anonymousKey: actor.key } : {}),
        title,
        prompt: input.prompt,
        expectedAnswer: input.expectedAnswer,
        judgeModelId: input.judge.modelId,
        judgeConnectionId: input.judge.connectionId ?? null,
        judgeRawId: input.judge.rawId ?? null,
        judgeThreshold,
        runsPerModel: input.runsPerModel,
        passK: input.passK,
        status: 'pending',
        configJson: safeJsonStringify(configPayload, '{}'),
      },
    })

    options?.emitEvent?.({
      type: 'run_start',
      payload: {
        id: run.id,
        title: run.title,
        prompt: run.prompt,
        expectedAnswer: run.expectedAnswer,
        judgeThreshold: run.judgeThreshold,
        runsPerModel: run.runsPerModel,
        passK: run.passK,
      },
    })

    await this.prisma.battleRun.update({
      where: { id: run.id },
      data: { status: 'running' },
    })

    const judgeResolution = await this.resolveModel(actor, input.judge)
    if (!judgeResolution) {
      await this.prisma.battleRun.update({
        where: { id: run.id },
        data: { status: 'error', summaryJson: safeJsonStringify({ error: 'Judge model not found' }, '{}') },
      })
      throw new Error('Judge model not found')
    }

    const resolvedModels = await Promise.all(
      input.models.map(async (model) => ({
        config: model,
        resolved: await this.resolveModel(actor, model),
      })),
    )
    const invalid = resolvedModels.find((item) => !item.resolved)
    if (invalid) {
      await this.prisma.battleRun.update({
        where: { id: run.id },
        data: { status: 'error', summaryJson: safeJsonStringify({ error: 'Model not found' }, '{}') },
      })
      throw new Error('Model not found')
    }

    const resolved = resolvedModels.map((item) => ({
      config: item.config,
      resolved: item.resolved!,
    }))

    const systemSettings = await this.loadSystemSettings()
    const maxConcurrency = this.normalizeConcurrency(input.maxConcurrency)
    const tasks: Array<() => Promise<void>> = []

    const results: BattleResultRecord[] = []

    for (const model of resolved) {
      for (let attempt = 1; attempt <= input.runsPerModel; attempt += 1) {
        tasks.push(async () => {
          const result = await this.runAttempt({
            actor,
            battleRunId: run.id,
            prompt: input.prompt,
            expectedAnswer: input.expectedAnswer,
            judgeThreshold,
            judgeModel: judgeResolution,
            model,
            attemptIndex: attempt,
            systemSettings,
          }, options?.emitEvent)
          results.push(result)
        })
      }
    }

    try {
      await this.runWithConcurrency(tasks, maxConcurrency)
      const summary = this.buildSummary(results, input.runsPerModel, input.passK, judgeThreshold)
      await this.prisma.battleRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          summaryJson: safeJsonStringify(summary, '{}'),
        },
      })

      options?.emitEvent?.({
        type: 'run_complete',
        payload: {
          id: run.id,
          summary,
        },
      })

      return {
        runId: run.id,
        summary,
      }
    } catch (error) {
      await this.prisma.battleRun.update({
        where: { id: run.id },
        data: {
          status: 'error',
          summaryJson: safeJsonStringify({ error: (error as Error)?.message || 'Battle failed' }, '{}'),
        },
      })
      throw error
    }
  }

  private async runAttempt(
    params: {
      actor: Actor
      battleRunId: number
      prompt: string
      expectedAnswer: string
      judgeThreshold: number
      judgeModel: { connection: Connection; rawModelId: string }
      model: { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }
      attemptIndex: number
      systemSettings: Record<string, string>
    },
    emitEvent?: (event: BattleExecutionEvent) => void,
  ): Promise<BattleResultRecord> {
    const { actor, battleRunId, prompt, expectedAnswer, judgeThreshold, judgeModel, model, attemptIndex, systemSettings } = params
    const modelId = model.config.modelId

    emitEvent?.({
      type: 'attempt_start',
      payload: {
        battleRunId,
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        modelKey: `${model.resolved.connection.id}:${model.resolved.rawModelId}`,
        attemptIndex,
      },
    })

    const consumeResult = await consumeActorQuota(actor)
    if (!consumeResult.success) {
      const result = await this.persistResult({
        battleRunId,
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        attemptIndex,
        features: model.config.features,
        customBody: model.config.custom_body,
        customHeaders: model.config.custom_headers,
        output: '',
        usage: {},
        durationMs: null,
        error: '配额已耗尽',
        judge: null,
      })
      emitEvent?.({
        type: 'attempt_complete',
        payload: {
          battleRunId,
          modelId,
          attemptIndex,
          result: this.serializeResult(result),
        },
      })
      return result
    }

    const startedAt = Date.now()
    let output = ''
    let usage: Record<string, any> = {}
    let error: string | null = null

    try {
      const runResult = await this.executeModel(prompt, model.config, model.resolved, systemSettings)
      output = runResult.content
      usage = runResult.usage
    } catch (err) {
      error = err instanceof Error ? err.message : '模型请求失败'
    }

    const durationMs = Math.max(0, Date.now() - startedAt)

    let judgeResult: { pass: boolean; score: number | null; reason: string | null; fallbackUsed: boolean } | null = null
    if (!error) {
      const judgeConsume = await consumeActorQuota(actor)
      if (!judgeConsume.success) {
        judgeResult = {
          pass: false,
          score: null,
          reason: '裁判配额已耗尽',
          fallbackUsed: true,
        }
      } else {
        try {
          judgeResult = await this.judgeAnswer({
            prompt,
            expectedAnswer,
            answer: output,
            threshold: judgeThreshold,
            judgeModel,
          })
        } catch (judgeError) {
          judgeResult = {
            pass: false,
            score: null,
            reason: judgeError instanceof Error ? judgeError.message : '裁判模型评测失败',
            fallbackUsed: true,
          }
        }
      }
    }

    const record = await this.persistResult({
      battleRunId,
      modelId,
      connectionId: model.resolved.connection.id,
      rawId: model.resolved.rawModelId,
      attemptIndex,
      features: model.config.features,
      customBody: model.config.custom_body,
      customHeaders: model.config.custom_headers,
      output,
      usage,
      durationMs,
      error,
      judge: judgeResult,
    })

    emitEvent?.({
      type: 'attempt_complete',
      payload: {
        battleRunId,
        modelId,
        attemptIndex,
        result: this.serializeResult(record),
      },
    })

    return record
  }

  private async executeModel(
    prompt: string,
    modelConfig: BattleModelInput,
    resolved: { connection: Connection; rawModelId: string },
    systemSettings: Record<string, string>,
  ) {
    const session = this.buildVirtualSession(resolved.connection, resolved.rawModelId)
    const providerSupportsTools = resolved.connection.provider === 'openai' || resolved.connection.provider === 'azure_openai'
    const requestedFeatures = modelConfig.features || {}
    const webSearchConfig = buildAgentWebSearchConfig(systemSettings)
    const pythonConfig = buildAgentPythonToolConfig(systemSettings)
    const webSearchActive =
      providerSupportsTools &&
      requestedFeatures.web_search === true &&
      webSearchConfig.enabled &&
      Boolean(webSearchConfig.apiKey)
    const pythonActive =
      providerSupportsTools &&
      requestedFeatures.python_tool === true &&
      pythonConfig.enabled
    const effectiveFeatures: BattleModelFeatures = {
      ...requestedFeatures,
      web_search: webSearchActive,
      python_tool: pythonActive,
    }
    if (!webSearchActive) {
      delete effectiveFeatures.web_search_scope
      delete effectiveFeatures.web_search_include_summary
      delete effectiveFeatures.web_search_include_raw
      delete effectiveFeatures.web_search_size
    }

    const payload: any = {
      sessionId: 0,
      content: prompt,
      reasoningEnabled: modelConfig.reasoningEnabled,
      reasoningEffort: modelConfig.reasoningEffort,
      ollamaThink: modelConfig.ollamaThink,
      contextEnabled: false,
      features: effectiveFeatures,
      custom_body: modelConfig.custom_body,
      custom_headers: modelConfig.custom_headers,
    }

    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content: prompt,
      images: [],
      mode: 'completion',
      personalPrompt: null,
    })

    if (effectiveFeatures.web_search || effectiveFeatures.python_tool) {
      return this.executeWithTools(prepared, { webSearchActive, pythonActive, features: effectiveFeatures })
    }

    return this.executeSimple(prepared)
  }

  private async executeSimple(prepared: PreparedChatRequest) {
    const response = await this.requester.requestWithBackoff({
      request: {
        url: prepared.providerRequest.url,
        headers: prepared.providerRequest.headers,
        body: prepared.providerRequest.body,
      },
      context: {
        sessionId: 0,
        provider: prepared.providerRequest.providerLabel,
        route: '/api/battle/execute',
        timeoutMs: prepared.providerRequest.timeoutMs,
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const json = (await response.json()) as any
    const text = json?.choices?.[0]?.message?.content || ''
    if (!text.trim()) {
      throw new Error('模型未返回有效文本')
    }

    const usage = buildUsage(json, {
      promptTokens: prepared.promptTokens,
      contextLimit: prepared.contextLimit,
      contextRemaining: prepared.contextRemaining,
    })

    return { content: text, usage }
  }

  private async executeWithTools(
    prepared: PreparedChatRequest,
    toolFlags: { webSearchActive: boolean; pythonActive: boolean; features: BattleModelFeatures },
  ) {
    const provider = prepared.providerRequest.providerLabel
    if (provider !== 'openai' && provider !== 'azure_openai') {
      return this.executeSimple(prepared)
    }

    const sysMap = prepared.systemSettings
    const webSearchConfig = buildAgentWebSearchConfig(sysMap)
    const pythonConfig = buildAgentPythonToolConfig(sysMap)
    const requestedFeatures = toolFlags.features || {}
    if (typeof requestedFeatures.web_search_scope === 'string') {
      webSearchConfig.scope = requestedFeatures.web_search_scope
    }
    if (typeof requestedFeatures.web_search_include_summary === 'boolean') {
      webSearchConfig.includeSummary = requestedFeatures.web_search_include_summary
    }
    if (typeof requestedFeatures.web_search_include_raw === 'boolean') {
      webSearchConfig.includeRawContent = requestedFeatures.web_search_include_raw
    }
    if (typeof requestedFeatures.web_search_size === 'number' && Number.isFinite(requestedFeatures.web_search_size)) {
      const next = Math.max(1, Math.min(10, requestedFeatures.web_search_size))
      webSearchConfig.resultLimit = next
    }

    const toolHandlers: Array<{ name: string; handler: WebSearchToolHandler | PythonToolHandler }> = []
    const toolDefinitions: any[] = []

    if (toolFlags.webSearchActive) {
      const handler = new WebSearchToolHandler(webSearchConfig)
      toolHandlers.push({ name: handler.toolName, handler })
      toolDefinitions.push(handler.toolDefinition)
    }
    if (toolFlags.pythonActive) {
      const handler = new PythonToolHandler(pythonConfig)
      toolHandlers.push({ name: handler.toolName, handler })
      toolDefinitions.push(handler.toolDefinition)
    }

    const handlerMap = new Map(toolHandlers.map((item) => [item.name, item.handler]))
    const maxIterations = resolveMaxToolIterations(sysMap)

    let workingMessages = prepared.messagesPayload.map((msg) => ({ ...msg }))
    let lastUsage = null as any

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const body = convertOpenAIReasoningPayload({
        ...prepared.baseRequestBody,
        stream: false,
        messages: workingMessages,
        tools: toolDefinitions,
        tool_choice: 'auto',
      })

      const response = await this.requester.requestWithBackoff({
        request: {
          url: prepared.providerRequest.url,
          headers: prepared.providerRequest.headers,
          body,
        },
        context: {
          sessionId: 0,
          provider,
          route: '/api/battle/execute',
          timeoutMs: prepared.providerRequest.timeoutMs,
        },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
      }

      const json = (await response.json()) as any
      const message = json?.choices?.[0]?.message || {}
      lastUsage = json?.usage ?? null

      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (toolCalls.length === 0) {
        const text = message.content || ''
        if (!text.trim()) {
          throw new Error('模型未返回有效文本')
        }
        const usage = buildUsage(json, {
          promptTokens: prepared.promptTokens,
          contextLimit: prepared.contextLimit,
          contextRemaining: prepared.contextRemaining,
        })
        return { content: text, usage }
      }

      workingMessages = workingMessages.concat({
        role: 'assistant',
        content: message.content || '',
        tool_calls: toolCalls,
      })

      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name || ''
        const handler = handlerMap.get(toolName)
        const args = this.safeParseToolArgs(toolCall)
        let result: ToolHandlerResult | null = null
        if (handler) {
          result = await handler.handle(toolCall as ToolCall, args, {
            sessionId: 0,
            emitReasoning: () => {},
            sendToolEvent: () => {},
          })
        } else {
          result = {
            toolCallId: toolCall.id || crypto.randomUUID(),
            toolName: toolName || 'unknown',
            message: {
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName || 'unknown',
              content: JSON.stringify({ error: 'Unsupported tool requested by the model' }),
            },
          }
        }

        workingMessages = workingMessages.concat(result.message)
      }
    }

    const fallbackUsage = lastUsage ? buildUsage({ usage: lastUsage }, {
      promptTokens: prepared.promptTokens,
      contextLimit: prepared.contextLimit,
      contextRemaining: prepared.contextRemaining,
    }) : {
      prompt_tokens: prepared.promptTokens,
      completion_tokens: 0,
      total_tokens: prepared.promptTokens,
      context_limit: prepared.contextLimit,
      context_remaining: prepared.contextRemaining,
    }

    return { content: '工具调用次数已达上限，未生成最终答案。', usage: fallbackUsage }
  }

  private safeParseToolArgs(toolCall: any): Record<string, unknown> {
    try {
      const raw = toolCall?.function?.arguments
      if (!raw) return {}
      return JSON.parse(raw)
    } catch {
      return {}
    }
  }

  private async judgeAnswer(params: {
    prompt: string
    expectedAnswer: string
    answer: string
    threshold: number
    judgeModel: { connection: Connection; rawModelId: string }
  }) {
    const { prompt, expectedAnswer, answer, threshold, judgeModel } = params

    const judgePrompt = this.buildJudgePrompt(prompt, expectedAnswer, answer)
    const session = this.buildVirtualSession(judgeModel.connection, judgeModel.rawModelId)
    const payload: any = {
      sessionId: 0,
      content: judgePrompt,
      contextEnabled: false,
      custom_body: { temperature: 0 },
    }

    const prepared = await this.requestBuilder.prepare({
      session,
      payload,
      content: judgePrompt,
      images: [],
      mode: 'completion',
      personalPrompt: null,
    })

    const response = await this.requester.requestWithBackoff({
      request: {
        url: prepared.providerRequest.url,
        headers: prepared.providerRequest.headers,
        body: prepared.providerRequest.body,
      },
      context: {
        sessionId: 0,
        provider: prepared.providerRequest.providerLabel,
        route: '/api/battle/judge',
        timeoutMs: prepared.providerRequest.timeoutMs,
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Judge API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const json = (await response.json()) as any
    const text = json?.choices?.[0]?.message?.content || ''
    if (!text.trim()) {
      throw new Error('裁判模型未返回有效内容')
    }

    const parsedRaw = extractJsonObject(text)
    const parsed = safeParseJson<Record<string, any>>(parsedRaw, {})
    const passField = typeof parsed.pass === 'boolean' ? parsed.pass : null
    const score = normalizeJudgeScore(parsed.score)
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : null

    const fallbackUsed = passField === null
    const pass = passField !== null ? passField : (score != null ? score >= threshold : false)

    return {
      pass,
      score,
      reason,
      fallbackUsed,
      raw: parsed,
    }
  }

  private buildJudgePrompt(question: string, expectedAnswer: string, answer: string) {
    return [
      '你是严格的答案裁判，只输出 JSON，不要包含多余解释。',
      '请根据“问题”和“期望答案”判断“模型答案”是否准确。',
      '输出格式：{"pass": true/false, "score": 0~1, "reason": "简短原因"}',
      '',
      `问题：${question}`,
      `期望答案：${expectedAnswer}`,
      `模型答案：${answer}`,
    ].join('\n')
  }

  private buildVirtualSession(connection: Connection, rawModelId: string) {
    return {
      id: -1,
      userId: null,
      anonymousKey: null,
      expiresAt: null,
      connectionId: connection.id,
      modelRawId: rawModelId,
      title: 'Battle',
      createdAt: new Date(),
      pinnedAt: null,
      reasoningEnabled: null,
      reasoningEffort: null,
      ollamaThink: null,
      systemPrompt: null,
      connection,
    } as any
  }

  private async persistResult(params: {
    battleRunId: number
    modelId: string
    connectionId: number | null
    rawId: string | null
    attemptIndex: number
    features?: BattleModelFeatures
    customBody?: Record<string, any>
    customHeaders?: Array<{ name: string; value: string }>
    output: string
    usage: Record<string, any>
    durationMs: number | null
    error: string | null
    judge: { pass: boolean; score: number | null; reason: string | null; fallbackUsed: boolean; raw?: Record<string, any> } | null
  }) {
    const record = await this.prisma.battleResult.create({
      data: {
        battleRunId: params.battleRunId,
        modelId: params.modelId,
        connectionId: params.connectionId,
        rawId: params.rawId,
        attemptIndex: params.attemptIndex,
        featuresJson: safeJsonStringify(params.features || {}, '{}'),
        customBodyJson: safeJsonStringify(summarizeCustomBody(params.customBody), '{}'),
        customHeadersJson: safeJsonStringify(sanitizeHeaders(params.customHeaders), '[]'),
        output: params.output || '',
        usageJson: safeJsonStringify(params.usage || {}, '{}'),
        durationMs: params.durationMs,
        error: params.error,
        judgePass: params.judge?.pass ?? null,
        judgeScore: params.judge?.score ?? null,
        judgeReason: params.judge?.reason ?? null,
        judgeFallbackUsed: params.judge?.fallbackUsed ?? false,
        judgeRawJson: safeJsonStringify(params.judge?.raw || {}, '{}'),
      },
    })
    return record
  }

  private serializeResult(record: any) {
    return {
      id: record.id,
      battleRunId: record.battleRunId,
      modelId: record.modelId,
      connectionId: record.connectionId,
      rawId: record.rawId,
      attemptIndex: record.attemptIndex,
      output: record.output,
      usage: safeParseJson(record.usageJson, {} as Record<string, any>),
      durationMs: record.durationMs,
      error: record.error,
      judgePass: record.judgePass,
      judgeScore: record.judgeScore,
      judgeReason: record.judgeReason,
      judgeFallbackUsed: record.judgeFallbackUsed,
    }
  }

  private buildSummary(results: BattleResultRecord[], runsPerModel: number, passK: number, judgeThreshold: number): BattleRunSummary {
    const groups = new Map<string, { modelId: string; connectionId: number | null; rawId: string | null; passCount: number; attempts: number }>()

    for (const result of results) {
      const key = `${result.modelId}:${result.connectionId ?? 'null'}:${result.rawId ?? 'null'}`
      const group = groups.get(key) || {
        modelId: result.modelId,
        connectionId: result.connectionId ?? null,
        rawId: result.rawId ?? null,
        passCount: 0,
        attempts: 0,
      }
      group.attempts += 1
      if (result.judgePass) group.passCount += 1
      groups.set(key, group)
    }

    const modelStats = Array.from(groups.values()).map((group) => {
      const accuracy = group.attempts > 0 ? group.passCount / group.attempts : 0
      return {
        modelId: group.modelId,
        connectionId: group.connectionId,
        rawId: group.rawId,
        passAtK: group.passCount >= passK,
        passCount: group.passCount,
        accuracy,
      }
    })

    const totalModels = modelStats.length
    const passModelCount = modelStats.filter((item) => item.passAtK).length
    const accuracy = totalModels > 0 ? passModelCount / totalModels : 0

    return {
      totalModels,
      runsPerModel,
      passK,
      judgeThreshold,
      passModelCount,
      accuracy,
      modelStats,
    }
  }

  private normalizeJudgeThreshold(value?: number) {
    if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_JUDGE_THRESHOLD
    return clamp(value, 0, 1)
  }

  private normalizeConcurrency(value?: number) {
    if (typeof value !== 'number' || Number.isNaN(value)) return 3
    return Math.min(6, Math.max(1, Math.floor(value)))
  }

  private async resolveModel(actor: Actor, input: { modelId: string; connectionId?: number; rawId?: string }) {
    return this.modelResolver.resolveModelForRequest({
      actor,
      userId: actor.type === 'user' ? actor.id : null,
      modelId: input.modelId,
      connectionId: input.connectionId,
      rawId: input.rawId,
    })
  }

  private async runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
    let cursor = 0
    const runWorker = async () => {
      while (cursor < tasks.length) {
        const index = cursor
        cursor += 1
        await tasks[index]()
      }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runWorker())
    await Promise.all(workers)
  }

  private serializeRunSummary(run: BattleRunRecord) {
    const rawSummary = safeParseJson<Record<string, any>>(run.summaryJson, {})
    const summary = normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })

    return {
      id: run.id,
      title: run.title,
      prompt: run.prompt,
      expectedAnswer: run.expectedAnswer,
      judgeModelId: run.judgeModelId,
      judgeConnectionId: run.judgeConnectionId,
      judgeRawId: run.judgeRawId,
      judgeThreshold: run.judgeThreshold,
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      status: run.status,
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
      summary,
    }
  }

  private normalizePagination(params?: { page?: number; limit?: number }) {
    const page = typeof params?.page === 'number' && params.page > 0 ? Math.trunc(params.page) : 1
    const limit =
      typeof params?.limit === 'number' && params.limit > 0 ? Math.min(Math.trunc(params.limit), 100) : 20
    return { page, limit }
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

  private computeExpiry(expiresInHours?: number | null) {
    if (!expiresInHours || !Number.isFinite(expiresInHours) || expiresInHours <= 0) {
      return null
    }
    const now = new Date()
    return new Date(now.getTime() + Math.floor(expiresInHours * 3600_000))
  }

  private async generateToken(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = crypto.randomBytes(16).toString('hex')
      const existing = await this.prisma.battleShare.findFirst({ where: { token } })
      if (!existing) return token
    }
    throw new Error('Failed to generate battle share token')
  }

  private buildOwnershipWhere(actor: Actor): Prisma.BattleRunWhereInput {
    return actor.type === 'user' ? { userId: actor.id } : { anonymousKey: actor.key }
  }
}

let battleService = new BattleService()

export const setBattleService = (service: BattleService) => {
  battleService = service
}

export { battleService }
