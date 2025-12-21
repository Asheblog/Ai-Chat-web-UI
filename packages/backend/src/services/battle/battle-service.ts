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
import { consumeBattleQuota } from '../../utils/battle-quota'
import { getBattlePolicy } from '../../utils/system-settings'

export type BattleRunStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled'

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
  features?: BattleModelFeatures
  customHeaders?: Array<{ name: string; value: string }>
  customBody?: Record<string, any> | null
  reasoningEnabled?: boolean | null
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  ollamaThink?: boolean | null
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
  reasoning: string
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
    reasoning: string
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

type BattleRunControl = {
  runId: number
  abortController: AbortController
  requestControllers: Set<AbortController>
  attemptControllers: Map<string, Set<AbortController>>
  cancelledAttempts: Set<string>
  attemptEpochs: Map<string, number>
  liveAttempts: Map<string, Map<number, LiveAttemptState>>
  taskGroups: Map<string, { queue: AttemptTask[]; running: boolean }>
  scheduler?: {
    enqueue: (modelKey: string, task: AttemptTask) => boolean
    isClosed: () => boolean
  }
  emitEvent?: (event: BattleExecutionEvent) => void
  runContext?: {
    prompt: string
    expectedAnswer: string
    judgeThreshold: number
    judgeModel: { connection: Connection; rawModelId: string }
    systemSettings: Record<string, string>
  }
  resolvedModels?: Map<string, { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }>
  cancelled: boolean
}

type LiveAttemptState = {
  modelId: string
  connectionId: number | null
  rawId: string | null
  attemptIndex: number
  status: 'pending' | 'running' | 'success' | 'error' | 'judging'
  output: string
  reasoning: string
  durationMs: number | null
  error: string | null
}

type AttemptTask = {
  modelKey: string
  attemptKey: string
  attemptIndex: number
  attemptEpoch: number
  run: () => Promise<void>
}

class BattleRunCancelledError extends Error {
  constructor(message = 'Battle cancelled') {
    super(message)
    this.name = 'BattleRunCancelledError'
  }
}

class BattleAttemptCancelledError extends Error {
  constructor(message = 'Attempt cancelled') {
    super(message)
    this.name = 'BattleAttemptCancelledError'
  }
}

export interface BattleExecutionEvent {
  type: 'run_start' | 'attempt_start' | 'attempt_delta' | 'attempt_complete' | 'run_complete' | 'run_cancelled' | 'error'
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

const normalizeCustomHeadersForConfig = (headers?: Array<{ name: string; value: string }>) => {
  if (!Array.isArray(headers)) return []
  return headers
    .map((item) => ({
      name: (item?.name || '').trim(),
      value: (item?.value || '').trim(),
    }))
    .filter((item) => item.name.length > 0)
    .slice(0, 10)
}

const normalizeCustomBodyForConfig = (body?: Record<string, any> | null) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null
  }
  const keys = Object.keys(body)
  if (keys.length === 1 && keys[0] === 'keys' && Array.isArray((body as any).keys)) {
    return null
  }
  return body
}

const normalizeConfigFeatures = (raw: unknown): BattleModelFeatures | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as Record<string, any>
  const features: BattleModelFeatures = {}
  if (typeof data.web_search === 'boolean') features.web_search = data.web_search
  if (typeof data.web_search_scope === 'string') {
    const scope = data.web_search_scope as BattleModelFeatures['web_search_scope']
    if (scope) features.web_search_scope = scope
  }
  if (typeof data.web_search_include_summary === 'boolean') {
    features.web_search_include_summary = data.web_search_include_summary
  }
  if (typeof data.web_search_include_raw === 'boolean') {
    features.web_search_include_raw = data.web_search_include_raw
  }
  if (typeof data.web_search_size === 'number' && Number.isFinite(data.web_search_size)) {
    features.web_search_size = Math.min(10, Math.max(1, Math.floor(data.web_search_size)))
  }
  if (typeof data.python_tool === 'boolean') features.python_tool = data.python_tool
  return Object.keys(features).length > 0 ? features : undefined
}

const normalizeReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | null => {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return null
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
      const features = normalizeConfigFeatures((item as Record<string, any>).features)
      const customHeaders = normalizeCustomHeadersForConfig(
        Array.isArray((item as Record<string, any>).customHeaders)
          ? (item as Record<string, any>).customHeaders
          : (item as Record<string, any>).custom_headers,
      )
      const customBody = normalizeCustomBodyForConfig(
        ((item as Record<string, any>).customBody ?? (item as Record<string, any>).custom_body) as
          | Record<string, any>
          | null
          | undefined,
      )
      const reasoningEnabled =
        typeof (item as Record<string, any>).reasoningEnabled === 'boolean'
          ? (item as Record<string, any>).reasoningEnabled
          : null
      const reasoningEffort = normalizeReasoningEffort((item as Record<string, any>).reasoningEffort)
      const ollamaThink =
        typeof (item as Record<string, any>).ollamaThink === 'boolean'
          ? (item as Record<string, any>).ollamaThink
          : null
      return {
        modelId,
        connectionId: isFiniteNumber(item.connectionId) ? item.connectionId : null,
        rawId: typeof item.rawId === 'string' && item.rawId.trim().length > 0 ? item.rawId.trim() : null,
        ...(features ? { features } : {}),
        ...(customHeaders.length > 0 ? { customHeaders } : {}),
        ...(customBody ? { customBody } : {}),
        reasoningEnabled,
        reasoningEffort,
        ollamaThink,
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

const buildModelKey = (modelId: string, connectionId?: number | null, rawId?: string | null) => {
  if (typeof connectionId === 'number' && rawId) {
    return `${connectionId}:${rawId}`
  }
  return `global:${modelId}`
}

const buildAttemptKey = (modelKey: string, attemptIndex: number) => `${modelKey}#${attemptIndex}`

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
  private activeRuns = new Map<number, BattleRunControl>()

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
        [
          ...results.map((item) => item.connectionId),
          ...configModels.map((item) => item.connectionId),
        ].filter((value): value is number => typeof value === 'number'),
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
      if (run.status === 'completed' || run.status === 'cancelled') {
        await this.prisma.battleRun.update({
          where: { id: run.id },
          data: { summaryJson: safeJsonStringify(summary, '{}') },
        })
      }
    }

    const liveAttempts = this.collectLiveAttempts(run.id, connectionMap)

    return {
      ...this.serializeRunSummary(run),
      judgeModelLabel: composeModelLabel(judgeConnection, run.judgeRawId, run.judgeModelId),
      config,
      summary,
      ...(liveAttempts && liveAttempts.length > 0 ? { live: { attempts: liveAttempts } } : {}),
      results: results.map((item) => ({
        id: item.id,
        battleRunId: item.battleRunId,
        modelId: item.modelId,
        connectionId: item.connectionId,
        rawId: item.rawId,
        modelLabel: composeModelLabel(connectionMap.get(item.connectionId || -1) || null, item.rawId, item.modelId),
        attemptIndex: item.attemptIndex,
        output: item.output,
        reasoning: item.reasoning || '',
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

  async cancelRun(actor: Actor, runId: number) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) return null

    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const summary = this.buildSummary(results as BattleResultRecord[], run.runsPerModel, run.passK, run.judgeThreshold)

    if (run.status === 'completed' || run.status === 'error' || run.status === 'cancelled') {
      return { status: run.status, summary }
    }

    this.cancelRunControl(run.id, 'cancelled')
    await this.prisma.battleRun.updateMany({
      where: { id: run.id, status: { in: ['pending', 'running'] } },
      data: {
        status: 'cancelled',
        summaryJson: safeJsonStringify(summary, '{}'),
      },
    })

    return { status: 'cancelled', summary }
  }

  async cancelAttempt(
    actor: Actor,
    params: { runId: number; modelId?: string | null; connectionId?: number | null; rawId?: string | null; attemptIndex: number },
  ) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: params.runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }
    if (run.status !== 'running' && run.status !== 'pending') {
      throw new Error('Battle run is not running')
    }

    const runControl = this.activeRuns.get(run.id)
    if (!runControl) {
      throw new Error('Battle run is not active')
    }

    const target = this.resolveAttemptTarget(runControl, params)
    if (!target) {
      throw new Error('Attempt target not found')
    }

    const live = this.getLiveAttempt(runControl, target.modelKey, params.attemptIndex)
    if (live && (live.status === 'success' || live.status === 'error')) {
      throw new Error('Attempt already completed')
    }

    const existing = await this.prisma.battleResult.findFirst({
      where: {
        battleRunId: run.id,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })
    if (existing && !existing.error) {
      throw new Error('Attempt already completed')
    }

    const attemptKey = buildAttemptKey(target.modelKey, params.attemptIndex)
    this.cancelAttemptControl(runControl, {
      attemptKey,
      modelId: target.modelId,
      connectionId: target.connectionId,
      rawId: target.rawId,
      attemptIndex: params.attemptIndex,
    })

    const isRunning = live?.status === 'running' || live?.status === 'judging'
    if (isRunning) {
      return { status: 'cancelling' as const }
    }

    if (!existing) {
      const group = runControl.taskGroups.get(target.modelKey)
      if (group) {
        group.queue = group.queue.filter((task) => task.attemptKey !== attemptKey)
      }
      const modelEntry = runControl.resolvedModels?.get(target.modelKey)
      if (!modelEntry) {
        throw new Error('Attempt model not found')
      }
      const record = await this.persistResult({
        battleRunId: run.id,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
        features: modelEntry.config.features,
        customBody: modelEntry.config.custom_body,
        customHeaders: modelEntry.config.custom_headers,
        output: '',
        reasoning: '',
        usage: {},
        durationMs: 0,
        error: '已取消',
        judge: null,
      })
      runControl.emitEvent?.({
        type: 'attempt_complete',
        payload: {
          battleRunId: run.id,
          modelId: target.modelId,
          attemptIndex: params.attemptIndex,
          result: this.serializeResult(record),
        },
      })
    }

    return { status: 'cancelled' as const }
  }

  async retryAttempt(
    actor: Actor,
    params: { runId: number; modelId?: string | null; connectionId?: number | null; rawId?: string | null; attemptIndex: number },
  ) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: params.runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }
    if (run.status !== 'running' && run.status !== 'pending') {
      throw new Error('Battle run is not running')
    }

    const runControl = this.activeRuns.get(run.id)
    if (!runControl) {
      throw new Error('Battle run is not active')
    }

    const target = this.resolveAttemptTarget(runControl, params)
    if (!target) {
      throw new Error('Attempt target not found')
    }

    const live = this.getLiveAttempt(runControl, target.modelKey, params.attemptIndex)
    if (live && (live.status === 'running' || live.status === 'judging' || live.status === 'pending')) {
      throw new Error('Attempt is still running')
    }

    const existing = await this.prisma.battleResult.findFirst({
      where: {
        battleRunId: run.id,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })
    if (!existing || !existing.error) {
      throw new Error('Attempt is not failed')
    }

    const attemptKey = buildAttemptKey(target.modelKey, params.attemptIndex)
    const nextEpoch = this.bumpAttemptEpoch(runControl, attemptKey)
    runControl.cancelledAttempts.delete(attemptKey)
    const controllers = runControl.attemptControllers.get(attemptKey)
    if (controllers) {
      for (const controller of controllers) {
        try {
          controller.abort('retry')
        } catch {}
      }
      runControl.attemptControllers.delete(attemptKey)
    }

    await this.prisma.battleResult.deleteMany({
      where: {
        battleRunId: run.id,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })

    const remainingResults = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const refreshedSummary = this.buildSummary(
      remainingResults as BattleResultRecord[],
      run.runsPerModel,
      run.passK,
      run.judgeThreshold,
    )
    await this.prisma.battleRun.update({
      where: { id: run.id },
      data: { summaryJson: safeJsonStringify(refreshedSummary, '{}') },
    })

    const modelEntry = runControl.resolvedModels?.get(target.modelKey)
    if (!modelEntry) {
      throw new Error('Attempt model not found')
    }

    this.ensureLiveAttempt(runControl, {
      modelId: target.modelId,
      connectionId: target.connectionId,
      rawId: target.rawId,
      attemptIndex: params.attemptIndex,
      status: 'pending',
      output: '',
      reasoning: '',
      durationMs: null,
      error: null,
    })

    const group = runControl.taskGroups.get(target.modelKey)
    if (group) {
      group.queue = group.queue.filter((task) => task.attemptKey !== attemptKey)
    }

    const scheduler = runControl.scheduler
    if (!scheduler || scheduler.isClosed()) {
      throw new Error('Battle run scheduler closed')
    }

    const task = this.createAttemptTask({
      battleRunId: run.id,
      model: modelEntry,
      attemptIndex: params.attemptIndex,
      runControl,
    })
    if (task.attemptEpoch !== nextEpoch) {
      task.attemptEpoch = nextEpoch
    }
    if (!scheduler.enqueue(target.modelKey, task)) {
      throw new Error('Failed to enqueue attempt')
    }

    return { status: 'retrying' as const }
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
      if (run.status === 'completed' || run.status === 'cancelled') {
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
        reasoning: item.reasoning || '',
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
    const battlePolicy = await getBattlePolicy()
    if (actor.type === 'user' && !battlePolicy.allowUsers) {
      throw new Error('当前系统未开放模型大乱斗给注册用户')
    }
    if (actor.type === 'anonymous' && !battlePolicy.allowAnonymous) {
      throw new Error('当前系统未开放模型大乱斗给匿名用户')
    }
    const quotaResult = await consumeBattleQuota(actor)
    if (!quotaResult.success) {
      throw new Error('今日模型大乱斗额度已耗尽')
    }

    const configPayload = {
      runsPerModel: input.runsPerModel,
      passK: input.passK,
      judgeThreshold,
      models: input.models.map((model) => ({
        modelId: model.modelId,
        connectionId: model.connectionId ?? null,
        rawId: model.rawId ?? null,
        features: model.features ?? {},
        customHeaders: normalizeCustomHeadersForConfig(model.custom_headers),
        customBody: normalizeCustomBodyForConfig(model.custom_body),
        reasoningEnabled: typeof model.reasoningEnabled === 'boolean' ? model.reasoningEnabled : null,
        reasoningEffort: normalizeReasoningEffort(model.reasoningEffort),
        ollamaThink: typeof model.ollamaThink === 'boolean' ? model.ollamaThink : null,
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
    const runControl = this.createRunControl(run.id)

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

    const startUpdate = await this.prisma.battleRun.updateMany({
      where: { id: run.id, status: 'pending' },
      data: { status: 'running' },
    })
    if (startUpdate.count === 0) {
      const summary = await this.finalizeCancelledRun(run.id, {
        runsPerModel: input.runsPerModel,
        passK: input.passK,
        judgeThreshold,
      })
      options?.emitEvent?.({
        type: 'run_cancelled',
        payload: {
          id: run.id,
          summary,
        },
      })
      this.releaseRunControl(run.id)
      return {
        runId: run.id,
        summary,
      }
    }

    try {
      this.throwIfRunCancelled(runControl)

      const judgeResolution = await this.resolveModel(actor, input.judge)
      this.throwIfRunCancelled(runControl)
      if (!judgeResolution) {
        await this.prisma.battleRun.updateMany({
          where: { id: run.id, status: { not: 'cancelled' } },
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
      this.throwIfRunCancelled(runControl)
      const invalid = resolvedModels.find((item) => !item.resolved)
      if (invalid) {
        await this.prisma.battleRun.updateMany({
          where: { id: run.id, status: { not: 'cancelled' } },
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
      const taskGroups = new Map<string, { queue: AttemptTask[]; running: boolean }>()
      const resolvedModelMap = new Map<string, { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }>()

      runControl.emitEvent = options?.emitEvent
      runControl.runContext = {
        prompt: input.prompt,
        expectedAnswer: input.expectedAnswer,
        judgeThreshold,
        judgeModel: judgeResolution,
        systemSettings,
      }
      runControl.resolvedModels = resolvedModelMap
      runControl.taskGroups = taskGroups

      for (const model of resolved) {
        const modelKey = buildModelKey(
          model.config.modelId,
          model.resolved.connection.id,
          model.resolved.rawModelId,
        )
        resolvedModelMap.set(modelKey, model)
        let group = taskGroups.get(modelKey)
        if (!group) {
          group = { queue: [], running: false }
          taskGroups.set(modelKey, group)
        }
        for (let attempt = 1; attempt <= input.runsPerModel; attempt += 1) {
          const task = this.createAttemptTask({
            battleRunId: run.id,
            model,
            attemptIndex: attempt,
            runControl,
          })
          group.queue.push(task)
        }
      }

      await this.runWithModelConcurrency(taskGroups, maxConcurrency, runControl)

      if (this.isRunCancelled(runControl)) {
        const summary = await this.finalizeCancelledRun(run.id, {
          runsPerModel: input.runsPerModel,
          passK: input.passK,
          judgeThreshold,
        })
        options?.emitEvent?.({
          type: 'run_cancelled',
          payload: {
            id: run.id,
            summary,
          },
        })
        return {
          runId: run.id,
          summary,
        }
      }

      const summary = await this.buildSummaryForRun(run.id, {
        runsPerModel: input.runsPerModel,
        passK: input.passK,
        judgeThreshold,
      })
      const updated = await this.prisma.battleRun.updateMany({
        where: { id: run.id, status: { not: 'cancelled' } },
        data: {
          status: 'completed',
          summaryJson: safeJsonStringify(summary, '{}'),
        },
      })

      if (updated.count === 0) {
        const currentStatus = await this.getRunStatus(run.id)
        if (currentStatus === 'cancelled') {
          options?.emitEvent?.({
            type: 'run_cancelled',
            payload: {
              id: run.id,
              summary,
            },
          })
          return {
            runId: run.id,
            summary,
          }
        }
      }

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
      if (this.isRunCancelled(runControl) || (await this.isRunCancelledInDb(run.id))) {
        const summary = await this.finalizeCancelledRun(run.id, {
          runsPerModel: input.runsPerModel,
          passK: input.passK,
          judgeThreshold,
        })
        options?.emitEvent?.({
          type: 'run_cancelled',
          payload: {
            id: run.id,
            summary,
          },
        })
        return {
          runId: run.id,
          summary,
        }
      }

      await this.prisma.battleRun.updateMany({
        where: { id: run.id, status: { not: 'cancelled' } },
        data: {
          status: 'error',
          summaryJson: safeJsonStringify({ error: (error as Error)?.message || 'Battle failed' }, '{}'),
        },
      })
      throw error
    } finally {
      this.releaseRunControl(run.id)
    }
  }

  private createAttemptTask(params: {
    battleRunId: number
    model: { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }
    attemptIndex: number
    runControl: BattleRunControl
  }): AttemptTask {
    const modelKey = buildModelKey(
      params.model.config.modelId,
      params.model.resolved.connection.id,
      params.model.resolved.rawModelId,
    )
    const attemptKey = buildAttemptKey(modelKey, params.attemptIndex)
    const attemptEpoch = this.getAttemptEpoch(params.runControl, attemptKey)
    const context = params.runControl.runContext
    if (!context) {
      throw new Error('Battle run context missing')
    }
    return {
      modelKey,
      attemptKey,
      attemptIndex: params.attemptIndex,
      attemptEpoch,
      run: async () => {
        await this.runAttempt({
          battleRunId: params.battleRunId,
          prompt: context.prompt,
          expectedAnswer: context.expectedAnswer,
          judgeThreshold: context.judgeThreshold,
          judgeModel: context.judgeModel,
          model: params.model,
          attemptIndex: params.attemptIndex,
          systemSettings: context.systemSettings,
          runControl: params.runControl,
          attemptEpoch,
        }, params.runControl.emitEvent)
      },
    }
  }

  private async runAttempt(
    params: {
      battleRunId: number
      prompt: string
      expectedAnswer: string
      judgeThreshold: number
      judgeModel: { connection: Connection; rawModelId: string }
      model: { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }
      attemptIndex: number
      systemSettings: Record<string, string>
      runControl?: BattleRunControl
      attemptEpoch?: number
    },
    emitEvent?: (event: BattleExecutionEvent) => void,
  ): Promise<void> {
    const {
      battleRunId,
      prompt,
      expectedAnswer,
      judgeThreshold,
      judgeModel,
      model,
      attemptIndex,
      systemSettings,
      runControl,
      attemptEpoch,
    } = params
    const modelId = model.config.modelId

    this.throwIfRunCancelled(runControl)

    const modelKey = buildModelKey(modelId, model.resolved.connection.id, model.resolved.rawModelId)
    const attemptKey = buildAttemptKey(modelKey, attemptIndex)
    const isCurrentAttempt = () => this.isAttemptEpochCurrent(runControl, attemptKey, attemptEpoch)
    if (!isCurrentAttempt()) {
      return
    }
    if (runControl) {
      this.ensureLiveAttempt(runControl, {
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        attemptIndex,
        status: 'running',
      })
    }

    if (this.isAttemptCancelled(runControl, attemptKey)) {
      if (!isCurrentAttempt()) {
        return
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
        output: '',
        reasoning: '',
        usage: {},
        durationMs: 0,
        error: '已取消',
        judge: null,
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
      return
    }

    emitEvent?.({
      type: 'attempt_start',
      payload: {
        battleRunId,
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        modelKey,
        attemptIndex,
      },
    })

    const startedAt = Date.now()
    let output = ''
    let reasoning = ''
    let usage: Record<string, any> = {}
    let error: string | null = null

    try {
      const runResult = await this.executeModel(
        prompt,
        model.config,
        model.resolved,
        systemSettings,
        runControl,
        attemptKey,
        (delta) => {
          if (!isCurrentAttempt()) return
          if (!delta?.content && !delta?.reasoning) return
          if (typeof delta.reasoning === 'string' && delta.reasoning) {
            reasoning += delta.reasoning
          }
          if (runControl) {
            this.appendLiveAttemptDelta(runControl, {
              modelId,
              connectionId: model.resolved.connection.id,
              rawId: model.resolved.rawModelId,
              attemptIndex,
              content: delta.content,
              reasoning: delta.reasoning,
            })
          }
          emitEvent?.({
            type: 'attempt_delta',
            payload: {
              battleRunId,
              modelId,
              connectionId: model.resolved.connection.id,
              rawId: model.resolved.rawModelId,
              modelKey,
              attemptIndex,
              delta: delta.content,
              reasoning: delta.reasoning,
            },
          })
        },
      )
      output = runResult.content
      usage = runResult.usage
    } catch (err) {
      if (this.isRunCancelled(runControl)) {
        throw new BattleRunCancelledError()
      }
      if (this.isAttemptCancelled(runControl, attemptKey) || err instanceof BattleAttemptCancelledError) {
        error = '已取消'
      } else {
        error = err instanceof Error ? err.message : '模型请求失败'
      }
    }

    this.throwIfRunCancelled(runControl)
    const durationMs = Math.max(0, Date.now() - startedAt)
    if (!isCurrentAttempt()) {
      return
    }

    let judgeResult: { pass: boolean; score: number | null; reason: string | null; fallbackUsed: boolean } | null = null
    if (!error) {
      if (runControl) {
        this.ensureLiveAttempt(runControl, {
          modelId,
          connectionId: model.resolved.connection.id,
          rawId: model.resolved.rawModelId,
          attemptIndex,
          status: 'judging',
          output,
          durationMs,
          error: null,
        })
      }
      try {
        judgeResult = await this.judgeAnswer({
          prompt,
          expectedAnswer,
          answer: output,
          threshold: judgeThreshold,
          judgeModel,
          runControl,
          attemptKey,
        })
      } catch (judgeError) {
        if (this.isRunCancelled(runControl)) {
          throw new BattleRunCancelledError()
        }
        if (this.isAttemptCancelled(runControl, attemptKey)) {
          judgeResult = {
            pass: false,
            score: null,
            reason: '已取消',
            fallbackUsed: true,
          }
        } else {
        judgeResult = {
          pass: false,
          score: null,
          reason: judgeError instanceof Error ? judgeError.message : '裁判模型评测失败',
          fallbackUsed: true,
        }
        }
      }
    }

    if (!isCurrentAttempt()) {
      return
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
      reasoning,
      usage,
      durationMs,
      error,
      judge: judgeResult,
    })

    if (runControl) {
      this.ensureLiveAttempt(runControl, {
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        attemptIndex,
        status: error ? 'error' : 'success',
        output,
        reasoning,
        durationMs,
        error,
      })
    }

    emitEvent?.({
      type: 'attempt_complete',
      payload: {
        battleRunId,
        modelId,
        attemptIndex,
        result: this.serializeResult(record),
      },
    })
    return
  }

  private async executeModel(
    prompt: string,
    modelConfig: BattleModelInput,
    resolved: { connection: Connection; rawModelId: string },
    systemSettings: Record<string, string>,
    runControl?: BattleRunControl,
    attemptKey?: string,
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    this.throwIfRunCancelled(runControl)
    if (attemptKey) {
      this.throwIfAttemptCancelled(runControl, attemptKey)
    }
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
      mode: emitDelta ? 'stream' : 'completion',
      personalPrompt: null,
    })

    if (effectiveFeatures.web_search || effectiveFeatures.python_tool) {
      return this.executeWithTools(
        prepared,
        { webSearchActive, pythonActive, features: effectiveFeatures },
        runControl,
        attemptKey,
        emitDelta,
      )
    }

    if (emitDelta) {
      return this.executeStreaming(prepared, runControl, attemptKey, emitDelta)
    }
    return this.executeSimple(prepared, runControl, attemptKey)
  }

  private async executeSimple(
    prepared: PreparedChatRequest,
    runControl?: BattleRunControl,
    attemptKey?: string,
  ) {
    this.throwIfRunCancelled(runControl)
    if (attemptKey) {
      this.throwIfAttemptCancelled(runControl, attemptKey)
    }
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
      ...this.buildAbortHandlers(runControl, attemptKey),
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

  private async executeStreaming(
    prepared: PreparedChatRequest,
    runControl: BattleRunControl | undefined,
    attemptKey: string | undefined,
    emitDelta: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    this.throwIfRunCancelled(runControl)
    if (attemptKey) {
      this.throwIfAttemptCancelled(runControl, attemptKey)
    }
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
      ...this.buildAbortHandlers(runControl, attemptKey),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let doneSeen = false
    let sawSse = false
    let sawJson = false
    let usage: Record<string, any> = {}

    const pushContent = (delta: string) => {
      if (!delta) return
      content += delta
      emitDelta({ content: delta })
    }

    const pushReasoning = (delta: string) => {
      if (!delta) return
      emitDelta({ reasoning: delta })
    }

    const recordUsage = (payload: any) => {
      if (!payload) return
      usage = buildUsage(
        { usage: payload.usage ?? payload },
        {
          promptTokens: prepared.promptTokens,
          contextLimit: prepared.contextLimit,
          contextRemaining: prepared.contextRemaining,
        },
      )
    }

    const extractDeltaPayload = (payload: any) => {
      const contentDelta =
        payload?.choices?.[0]?.delta?.content ??
        payload?.choices?.[0]?.delta?.text ??
        payload?.delta?.content ??
        payload?.delta?.text ??
        payload?.message?.content ??
        payload?.response ??
        payload?.choices?.[0]?.message?.content ??
        payload?.text ??
        ''
      const reasoningDelta =
        payload?.choices?.[0]?.delta?.reasoning_content ??
        payload?.choices?.[0]?.delta?.reasoning ??
        payload?.choices?.[0]?.delta?.thinking ??
        payload?.choices?.[0]?.delta?.analysis ??
        payload?.delta?.reasoning_content ??
        payload?.delta?.reasoning ??
        payload?.message?.reasoning_content ??
        payload?.message?.reasoning ??
        payload?.reasoning ??
        payload?.analysis ??
        ''
      return { contentDelta, reasoningDelta }
    }

    const handleJsonPayload = (payload: any) => {
      if (!payload) return
      const { contentDelta, reasoningDelta } = extractDeltaPayload(payload)
      if (typeof contentDelta === 'string' && contentDelta) {
        pushContent(contentDelta)
      }
      if (typeof reasoningDelta === 'string' && reasoningDelta) {
        pushReasoning(reasoningDelta)
      }
      if (payload?.done === true) {
        doneSeen = true
      }
      if (payload?.usage || payload?.prompt_eval_count != null || payload?.eval_count != null) {
        recordUsage(payload)
      }
    }

    const handleLine = (line: string) => {
      const trimmed = line.replace(/\r$/, '')
      if (!trimmed) return
      if (trimmed.startsWith('data:')) {
        sawSse = true
        const data = trimmed.slice(5).trimStart()
        if (!data) return
        if (data === '[DONE]') {
          doneSeen = true
          return
        }
        try {
          const parsed = JSON.parse(data)
          handleJsonPayload(parsed)
        } catch {
          return
        }
        return
      }

      if (sawSse) return

      try {
        const parsed = JSON.parse(trimmed)
        sawJson = true
        handleJsonPayload(parsed)
      } catch {
        return
      }
    }

    try {
      while (true) {
        this.throwIfRunCancelled(runControl)
        if (attemptKey) {
          this.throwIfAttemptCancelled(runControl, attemptKey)
        }
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            handleLine(line)
            if (doneSeen) break
          }
        }
        if (doneSeen || done) break
      }

      if (!doneSeen && buffer.trim()) {
        handleLine(buffer.trim())
      }
    } finally {
      reader.releaseLock()
    }

    if (!content.trim() && !sawJson && buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim())
        handleJsonPayload(parsed)
      } catch {
        // ignore
      }
    }

    if (!content.trim()) {
      throw new Error('模型未返回有效文本')
    }

    return { content, usage }
  }

  private async executeWithTools(
    prepared: PreparedChatRequest,
    toolFlags: { webSearchActive: boolean; pythonActive: boolean; features: BattleModelFeatures },
    runControl?: BattleRunControl,
    attemptKey?: string,
    emitDelta?: (delta: { content?: string; reasoning?: string }) => void,
  ) {
    const provider = prepared.providerRequest.providerLabel
    if (provider !== 'openai' && provider !== 'azure_openai') {
      return this.executeSimple(prepared, runControl, attemptKey)
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
      this.throwIfRunCancelled(runControl)
      if (attemptKey) {
        this.throwIfAttemptCancelled(runControl, attemptKey)
      }
      if (emitDelta) {
          const streamed = await this.streamToolIteration({
            prepared,
            provider,
            messages: workingMessages,
            toolDefinitions,
            runControl,
            attemptKey,
            emitDelta,
          })
        if (streamed.usage) {
          lastUsage = streamed.usage
        }
        if (streamed.toolCalls.length === 0) {
          const text = streamed.content || ''
          if (!text.trim()) {
            throw new Error('模型未返回有效文本')
          }
          const usage = streamed.usage
            ? buildUsage({ usage: streamed.usage }, {
              promptTokens: prepared.promptTokens,
              contextLimit: prepared.contextLimit,
              contextRemaining: prepared.contextRemaining,
            })
            : {}
          return { content: text, usage }
        }

        workingMessages = workingMessages.concat({
          role: 'assistant',
          content: streamed.content || '',
          tool_calls: streamed.toolCalls,
        })

        for (const toolCall of streamed.toolCalls) {
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
        continue
      }

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
        ...this.buildAbortHandlers(runControl, attemptKey),
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

  private async streamToolIteration(params: {
    prepared: PreparedChatRequest
    provider: string
    messages: any[]
    toolDefinitions: any[]
    runControl?: BattleRunControl
    attemptKey?: string
    emitDelta: (delta: { content?: string; reasoning?: string }) => void
  }) {
    const body = convertOpenAIReasoningPayload({
      ...params.prepared.baseRequestBody,
      stream: true,
      messages: params.messages,
      tools: params.toolDefinitions,
      tool_choice: 'auto',
    })

    const response = await this.requester.requestWithBackoff({
      request: {
        url: params.prepared.providerRequest.url,
        headers: params.prepared.providerRequest.headers,
        body,
      },
      context: {
        sessionId: 0,
        provider: params.provider,
        route: '/api/battle/execute',
        timeoutMs: params.prepared.providerRequest.timeoutMs,
      },
      ...this.buildAbortHandlers(params.runControl, params.attemptKey),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`AI API request failed: ${response.status} ${response.statusText} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is not readable')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let usageSnapshot: Record<string, any> | null = null
    let sawSse = false
    let doneSeen = false
    const toolCallBuffers = new Map<
      number,
      { id?: string; type?: string; function: { name?: string; arguments: string } }
    >()
    let fallbackToolCalls: ToolCall[] = []

    const handleToolDelta = (toolDelta: any) => {
      const idx = typeof toolDelta?.index === 'number' ? toolDelta.index : 0
      const existing = toolCallBuffers.get(idx) || { function: { name: undefined, arguments: '' } }
      if (toolDelta?.id) existing.id = toolDelta.id
      if (toolDelta?.type) existing.type = toolDelta.type
      if (toolDelta?.function?.name) existing.function.name = toolDelta.function.name
      if (toolDelta?.function?.arguments) {
        existing.function.arguments = `${existing.function.arguments || ''}${toolDelta.function.arguments}`
      }
      toolCallBuffers.set(idx, existing)
    }

    const aggregateToolCalls = () =>
      Array.from(toolCallBuffers.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([_, entry]) => ({
          id: entry.id || crypto.randomUUID(),
          type: entry.type || 'function',
          function: {
            name: entry.function.name || 'unknown',
            arguments: entry.function.arguments || '{}',
          },
        }))

    const extractDeltaPayload = (payload: any) => {
      const contentDelta =
        payload?.choices?.[0]?.delta?.content ??
        payload?.choices?.[0]?.delta?.text ??
        payload?.delta?.content ??
        payload?.delta?.text ??
        payload?.message?.content ??
        payload?.response ??
        payload?.choices?.[0]?.message?.content ??
        payload?.text ??
        ''
      const reasoningDelta =
        payload?.choices?.[0]?.delta?.reasoning_content ??
        payload?.choices?.[0]?.delta?.reasoning ??
        payload?.choices?.[0]?.delta?.thinking ??
        payload?.choices?.[0]?.delta?.analysis ??
        payload?.delta?.reasoning_content ??
        payload?.delta?.reasoning ??
        payload?.message?.reasoning_content ??
        payload?.message?.reasoning ??
        payload?.reasoning ??
        payload?.analysis ??
        ''
      return { contentDelta, reasoningDelta }
    }

    try {
      while (true) {
        this.throwIfRunCancelled(params.runControl)
        if (params.attemptKey) {
          this.throwIfAttemptCancelled(params.runControl, params.attemptKey)
        }
        const { done, value } = await reader.read()
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const normalized = line.replace(/\r$/, '')
            if (!normalized.startsWith('data:')) continue
            sawSse = true
            const data = normalized.slice(5).trimStart()
            if (!data) continue
            if (data === '[DONE]') {
              doneSeen = true
              break
            }
            let parsed: any
            try {
              parsed = JSON.parse(data)
            } catch {
              continue
            }
            const { contentDelta, reasoningDelta } = extractDeltaPayload(parsed)
            if (typeof contentDelta === 'string' && contentDelta) {
              content += contentDelta
              params.emitDelta({ content: contentDelta })
            }
            if (typeof reasoningDelta === 'string' && reasoningDelta) {
              params.emitDelta({ reasoning: reasoningDelta })
            }
            const choice = parsed?.choices?.[0]
            const delta = choice?.delta || {}
            if (Array.isArray(delta.tool_calls)) {
              for (const toolDelta of delta.tool_calls) {
                handleToolDelta(toolDelta)
              }
            }
            if (parsed?.usage) {
              usageSnapshot = parsed.usage
            }
          }
        }
        if (doneSeen || done) break
      }
    } finally {
      reader.releaseLock()
    }

    if (!sawSse) {
      const raw = buffer.trim()
      if (raw) {
        try {
          const parsed = JSON.parse(raw)
          const message = parsed?.choices?.[0]?.message || {}
          content = typeof message.content === 'string' ? message.content : ''
          const reasoningText =
            (typeof message.reasoning_content === 'string' && message.reasoning_content) ||
            (typeof message.reasoning === 'string' && message.reasoning) ||
            (typeof message.analysis === 'string' && message.analysis) ||
            (typeof parsed?.reasoning === 'string' && parsed.reasoning) ||
            (typeof parsed?.analysis === 'string' && parsed.analysis) ||
            ''
          if (reasoningText) {
            params.emitDelta({ reasoning: reasoningText })
          }
          const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
          fallbackToolCalls = toolCalls as ToolCall[]
          if (parsed?.usage) usageSnapshot = parsed.usage
        } catch {
          // ignore
        }
      }
    }

    const toolCalls = toolCallBuffers.size > 0 ? aggregateToolCalls() : fallbackToolCalls

    return {
      content,
      toolCalls,
      usage: usageSnapshot,
    }
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
    runControl?: BattleRunControl
    attemptKey?: string
  }) {
    const { prompt, expectedAnswer, answer, threshold, judgeModel, runControl, attemptKey } = params
    this.throwIfRunCancelled(runControl)
    if (attemptKey) {
      this.throwIfAttemptCancelled(runControl, attemptKey)
    }

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
      ...this.buildAbortHandlers(runControl, attemptKey),
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
    reasoning: string
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
        reasoning: params.reasoning || '',
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
      reasoning: record.reasoning || '',
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

  private createRunControl(runId: number): BattleRunControl {
    const existing = this.activeRuns.get(runId)
    if (existing) return existing
    const control: BattleRunControl = {
      runId,
      abortController: new AbortController(),
      requestControllers: new Set(),
      attemptControllers: new Map(),
      cancelledAttempts: new Set(),
      attemptEpochs: new Map(),
      liveAttempts: new Map(),
      taskGroups: new Map(),
      cancelled: false,
    }
    this.activeRuns.set(runId, control)
    return control
  }

  private releaseRunControl(runId: number) {
    this.activeRuns.delete(runId)
  }

  private cancelRunControl(runId: number, reason?: string) {
    const control = this.activeRuns.get(runId)
    if (!control || control.cancelled) return
    control.cancelled = true
    for (const attemptsByModel of control.liveAttempts.values()) {
      for (const attempt of attemptsByModel.values()) {
        if (attempt.status === 'running' || attempt.status === 'pending' || attempt.status === 'judging') {
          attempt.status = 'error'
          if (!attempt.error) {
            attempt.error = '已取消'
          }
        }
      }
    }
    try {
      control.abortController.abort(reason ?? 'cancelled')
    } catch {}
    for (const controller of control.requestControllers) {
      try {
        controller.abort(reason ?? 'cancelled')
      } catch {}
    }
  }

  private cancelAttemptControl(
    runControl: BattleRunControl,
    params: {
      attemptKey: string
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
    },
    reason?: string,
  ) {
    runControl.cancelledAttempts.add(params.attemptKey)
    this.ensureLiveAttempt(runControl, {
      modelId: params.modelId,
      connectionId: params.connectionId,
      rawId: params.rawId,
      attemptIndex: params.attemptIndex,
      status: 'error',
      output: '',
      reasoning: '',
      durationMs: null,
      error: '已取消',
    })

    const controllers = runControl.attemptControllers.get(params.attemptKey)
    if (controllers) {
      for (const controller of controllers) {
        try {
          controller.abort(reason ?? 'cancelled')
        } catch {}
      }
    }
  }

  private isRunCancelled(runControl?: BattleRunControl) {
    return Boolean(runControl?.cancelled || runControl?.abortController.signal.aborted)
  }

  private isAttemptCancelled(runControl: BattleRunControl | undefined, attemptKey: string) {
    return Boolean(runControl?.cancelledAttempts.has(attemptKey))
  }

  private throwIfRunCancelled(runControl?: BattleRunControl) {
    if (this.isRunCancelled(runControl)) {
      throw new BattleRunCancelledError()
    }
  }

  private throwIfAttemptCancelled(runControl: BattleRunControl | undefined, attemptKey: string) {
    if (this.isAttemptCancelled(runControl, attemptKey)) {
      throw new BattleAttemptCancelledError()
    }
  }

  private buildAbortHandlers(runControl?: BattleRunControl, attemptKey?: string) {
    if (!runControl) return {}
    let activeController: AbortController | null = null
    return {
      onControllerReady: (controller: AbortController | null) => {
        if (!controller) return
        activeController = controller
        runControl.requestControllers.add(controller)
        if (attemptKey) {
          const set = runControl.attemptControllers.get(attemptKey) || new Set<AbortController>()
          set.add(controller)
          runControl.attemptControllers.set(attemptKey, set)
          if (runControl.cancelledAttempts.has(attemptKey)) {
            try {
              controller.abort(runControl.abortController.signal.reason ?? 'cancelled')
            } catch {}
          }
        }
        if (runControl.abortController.signal.aborted) {
          try {
            controller.abort(runControl.abortController.signal.reason ?? 'cancelled')
          } catch {}
        }
      },
      onControllerClear: () => {
        if (activeController) {
          runControl.requestControllers.delete(activeController)
          if (attemptKey) {
            const set = runControl.attemptControllers.get(attemptKey)
            if (set) {
              set.delete(activeController)
              if (set.size === 0) {
                runControl.attemptControllers.delete(attemptKey)
              }
            }
          }
          activeController = null
        }
      },
    }
  }

  private ensureLiveAttempt(
    runControl: BattleRunControl,
    params: {
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      status: LiveAttemptState['status']
      output?: string
      reasoning?: string
      durationMs?: number | null
      error?: string | null
    },
  ) {
    const modelKey = buildModelKey(params.modelId, params.connectionId, params.rawId)
    let attempts = runControl.liveAttempts.get(modelKey)
    if (!attempts) {
      attempts = new Map()
      runControl.liveAttempts.set(modelKey, attempts)
    }
    const existing = attempts.get(params.attemptIndex)
    if (existing) {
      const next: LiveAttemptState = {
        ...existing,
        status: params.status ?? existing.status,
        output: params.output ?? existing.output,
        reasoning: params.reasoning ?? existing.reasoning,
        durationMs: params.durationMs !== undefined ? params.durationMs : existing.durationMs,
        error: params.error !== undefined ? params.error : existing.error,
      }
      attempts.set(params.attemptIndex, next)
      return next
    }
    const record: LiveAttemptState = {
      modelId: params.modelId,
      connectionId: params.connectionId,
      rawId: params.rawId,
      attemptIndex: params.attemptIndex,
      status: params.status,
      output: params.output ?? '',
      reasoning: params.reasoning ?? '',
      durationMs: params.durationMs ?? null,
      error: params.error ?? null,
    }
    attempts.set(params.attemptIndex, record)
    return record
  }

  private getAttemptEpoch(runControl: BattleRunControl, attemptKey: string) {
    return runControl.attemptEpochs.get(attemptKey) ?? 0
  }

  private bumpAttemptEpoch(runControl: BattleRunControl, attemptKey: string) {
    const next = this.getAttemptEpoch(runControl, attemptKey) + 1
    runControl.attemptEpochs.set(attemptKey, next)
    return next
  }

  private isAttemptEpochCurrent(
    runControl: BattleRunControl | undefined,
    attemptKey: string,
    attemptEpoch?: number,
  ) {
    if (!runControl || typeof attemptEpoch !== 'number') return true
    return this.getAttemptEpoch(runControl, attemptKey) === attemptEpoch
  }

  private getLiveAttempt(
    runControl: BattleRunControl,
    modelKey: string,
    attemptIndex: number,
  ): LiveAttemptState | null {
    const attempts = runControl.liveAttempts.get(modelKey)
    if (!attempts) return null
    return attempts.get(attemptIndex) || null
  }

  private appendLiveAttemptDelta(
    runControl: BattleRunControl,
    params: {
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      content?: string
      reasoning?: string
    },
  ) {
    const record = this.ensureLiveAttempt(runControl, {
      modelId: params.modelId,
      connectionId: params.connectionId,
      rawId: params.rawId,
      attemptIndex: params.attemptIndex,
      status: 'running',
    })
    if (params.content) {
      record.output = `${record.output}${params.content}`
    }
    if (params.reasoning) {
      record.reasoning = `${record.reasoning}${params.reasoning}`
    }
  }

  private collectLiveAttempts(runId: number, connectionMap: Map<number, { id: number; prefixId: string }>) {
    const control = this.activeRuns.get(runId)
    if (!control) return null
    const attempts: Array<LiveAttemptState & { modelLabel: string | null }> = []
    for (const attemptsByModel of control.liveAttempts.values()) {
      for (const attempt of attemptsByModel.values()) {
        attempts.push({
          ...attempt,
          modelLabel: composeModelLabel(
            attempt.connectionId != null ? connectionMap.get(attempt.connectionId) || null : null,
            attempt.rawId,
            attempt.modelId,
          ),
        })
      }
    }
    attempts.sort((a, b) => {
      const keyA = buildModelKey(a.modelId, a.connectionId, a.rawId)
      const keyB = buildModelKey(b.modelId, b.connectionId, b.rawId)
      if (keyA === keyB) return a.attemptIndex - b.attemptIndex
      return keyA.localeCompare(keyB)
    })
    return attempts
  }

  private async getRunStatus(runId: number) {
    const record = await this.prisma.battleRun.findFirst({
      where: { id: runId },
      select: { status: true },
    })
    return record?.status ?? null
  }

  private async isRunCancelledInDb(runId: number) {
    const status = await this.getRunStatus(runId)
    return status === 'cancelled'
  }

  private async buildSummaryForRun(
    runId: number,
    config: { runsPerModel: number; passK: number; judgeThreshold: number },
  ) {
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: runId },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    return this.buildSummary(results as BattleResultRecord[], config.runsPerModel, config.passK, config.judgeThreshold)
  }

  private async finalizeCancelledRun(
    runId: number,
    config: { runsPerModel: number; passK: number; judgeThreshold: number },
  ) {
    const summary = await this.buildSummaryForRun(runId, config)
    await this.prisma.battleRun.updateMany({
      where: { id: runId, status: { in: ['pending', 'running'] } },
      data: {
        status: 'cancelled',
        summaryJson: safeJsonStringify(summary, '{}'),
      },
    })
    return summary
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

  private async runWithModelConcurrency(
    groupsMap: Map<string, { queue: AttemptTask[]; running: boolean }>,
    limit: number,
    runControl?: BattleRunControl,
  ) {
    const groups = Array.from(groupsMap.values())
    const totalTasks = groups.reduce((acc, group) => acc + group.queue.length, 0)
    if (groups.length === 0 || totalTasks === 0) return
    const maxConcurrency = Math.max(1, Math.min(limit, totalTasks))

    let active = 0
    let cursor = 0
    let settled = false
    let scheduling = false

    const hasPending = () => groups.some((group) => group.queue.length > 0)
    const findNextGroupIndex = () => {
      const count = groups.length
      if (count === 0) return -1
      for (let offset = 0; offset < count; offset += 1) {
        const index = (cursor + offset) % count
        const group = groups[index]
        if (!group.running && group.queue.length > 0) {
          cursor = (index + 1) % count
          return index
        }
      }
      return -1
    }

    await new Promise<void>((resolve, reject) => {
      const finishResolve = () => {
        if (settled) return
        settled = true
        if (runControl) {
          runControl.scheduler = undefined
        }
        resolve()
      }
      const finishReject = (error: unknown) => {
        if (settled) return
        settled = true
        if (runControl) {
          runControl.scheduler = undefined
        }
        reject(error)
      }
      const schedule = () => {
        if (settled || scheduling) return
        scheduling = true
        queueMicrotask(() => {
          scheduling = false
          if (settled) return
          if (this.isRunCancelled(runControl)) {
            if (active === 0) {
              finishResolve()
            }
            return
          }

          while (active < maxConcurrency) {
            if (this.isRunCancelled(runControl)) break
            const index = findNextGroupIndex()
            if (index < 0) break
            const group = groups[index]
            const task = group.queue.shift()
            if (!task) continue
            group.running = true
            active += 1
            Promise.resolve()
              .then(task.run)
              .then(() => {
                active -= 1
                group.running = false
                schedule()
              })
              .catch((error) => {
                finishReject(error)
              })
          }

          if (active === 0 && !hasPending()) {
            finishResolve()
          }
        })
      }

      if (runControl) {
        runControl.taskGroups = groupsMap
        runControl.scheduler = {
          enqueue: (modelKey, task) => {
            if (settled || this.isRunCancelled(runControl)) return false
            let group = groupsMap.get(modelKey)
            if (!group) {
              group = { queue: [], running: false }
              groupsMap.set(modelKey, group)
              groups.push(group)
            }
            group.queue.push(task)
            schedule()
            return true
          },
          isClosed: () => settled,
        }
      }

      schedule()
    })
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

  private resolveAttemptTarget(
    runControl: BattleRunControl,
    params: { modelId?: string | null; connectionId?: number | null; rawId?: string | null; attemptIndex: number },
  ) {
    const connectionId = typeof params.connectionId === 'number' ? params.connectionId : null
    const rawId = typeof params.rawId === 'string' && params.rawId.trim() ? params.rawId.trim() : null
    const modelId = typeof params.modelId === 'string' && params.modelId.trim() ? params.modelId.trim() : null
    const resolvedModels = runControl.resolvedModels ?? new Map()

    let modelKey: string | null = null
    if (connectionId != null && rawId) {
      modelKey = buildModelKey(modelId || '', connectionId, rawId)
    } else if (modelId) {
      for (const [key, entry] of resolvedModels.entries()) {
        if (entry.config.modelId === modelId) {
          modelKey = key
          break
        }
      }
      modelKey = modelKey ?? buildModelKey(modelId, null, null)
    }

    if (!modelKey) return null
    const entry = resolvedModels.get(modelKey)
    const resolvedModelId = entry?.config.modelId ?? modelId
    if (!resolvedModelId) return null
    const resolvedConnectionId = entry?.resolved.connection.id ?? connectionId ?? null
    const resolvedRawId = entry?.resolved.rawModelId ?? rawId ?? null

    return {
      modelKey,
      modelId: resolvedModelId,
      connectionId: resolvedConnectionId,
      rawId: resolvedRawId,
    }
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
