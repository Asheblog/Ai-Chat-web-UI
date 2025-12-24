import crypto from 'node:crypto'
import type { Prisma, PrismaClient, Connection } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import type { ModelResolverService } from '../catalog/model-resolver-service'
import { modelResolverService as defaultModelResolverService } from '../catalog/model-resolver-service'
import { consumeBattleQuota } from '../../utils/battle-quota'
import { getBattlePolicy } from '../../utils/system-settings'
import { TaskTraceRecorder, shouldEnableTaskTrace, truncateString, type TaskTraceStatus } from '../../utils/task-trace'
import type { BattleStreamEvent } from '@aichat/shared/battle-contract'
import { BattleExecutor, type BattleExecutionContext } from './battle-executor'
import { safeJsonStringify, safeParseJson } from './battle-serialization'
import type {
  BattleModelFeatures,
  BattleModelInput,
  BattleRunConfig,
  BattleRunConfigModel,
  BattleRunCreateInput,
  BattleRunRecord,
  BattleRunSummary,
  BattleShareDetail,
  BattleSharePayload,
  BattleResultRecord,
} from './battle-types'

type BattleRunControl = {
  runId: number
  abortController: AbortController
  requestControllers: Set<AbortController>
  attemptControllers: Map<string, Set<AbortController>>
  cancelledAttempts: Set<string>
  attemptEpochs: Map<string, number>
  liveAttempts: Map<string, Map<number, LiveAttemptState>>
  taskGroups: Map<string, { queue: AttemptTask[]; running: boolean }>
  traceRecorder?: TaskTraceRecorder | null
  scheduler?: {
    enqueue: (modelKey: string, task: AttemptTask) => boolean
    isClosed: () => boolean
  }
  emitEvent?: (event: BattleStreamEvent) => void
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

export interface BattleServiceDeps {
  prisma?: PrismaClient
  modelResolver?: ModelResolverService
  executor?: BattleExecutor
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
        judgedCount: isFiniteNumber(item.judgedCount) ? Math.max(0, Math.floor(item.judgedCount)) : undefined,
        totalAttempts: isFiniteNumber(item.totalAttempts) ? Math.max(0, Math.floor(item.totalAttempts)) : undefined,
        judgeErrorCount: isFiniteNumber(item.judgeErrorCount) ? Math.max(0, Math.floor(item.judgeErrorCount)) : undefined,
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
      const extraPromptRaw = (item as Record<string, any>).extraPrompt
      const extraPrompt = typeof extraPromptRaw === 'string' ? extraPromptRaw.trim() : ''
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
        ...(extraPrompt ? { extraPrompt } : {}),
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

export class BattleService {
  private prisma: PrismaClient
  private modelResolver: ModelResolverService
  private executor: BattleExecutor
  private activeRuns = new Map<number, BattleRunControl>()

  constructor(deps: BattleServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.modelResolver = deps.modelResolver ?? defaultModelResolverService
    this.executor = deps.executor ?? new BattleExecutor()
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
        judgeStatus: (item as any).judgeStatus ?? 'unknown',
        judgeError: (item as any).judgeError ?? null,
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
        judgeStatus: 'skipped',
        judgeError: null,
        judge: null,
      })
      runControl.traceRecorder?.log('battle:attempt_complete', {
        ...this.buildAttemptTraceContext(runControl, attemptKey, {
          modelId: target.modelId,
          connectionId: target.connectionId,
          rawId: target.rawId,
        }),
        status: 'cancelled',
        durationMs: 0,
        error: '已取消',
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
    runControl.traceRecorder?.log('battle:attempt_retry', {
      ...this.buildAttemptTraceContext(runControl, attemptKey, {
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
      }),
      status: 'pending',
      reason: 'manual_retry',
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

  async retryJudgeForResult(actor: Actor, params: { resultId: number }) {
    const record = await this.prisma.battleResult.findFirst({
      where: {
        id: params.resultId,
      },
    })
    if (!record) {
      throw new Error('Battle result not found')
    }

    const run = await this.prisma.battleRun.findFirst({
      where: { id: record.battleRunId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }

    if (record.error) {
      throw new Error('Attempt failed; cannot judge')
    }

    const judgeResolution = await this.resolveModel(actor, {
      modelId: run.judgeModelId,
      connectionId: run.judgeConnectionId ?? undefined,
      rawId: run.judgeRawId ?? undefined,
    })
    if (!judgeResolution) {
      throw new Error('Judge model not found')
    }

    await this.prisma.battleResult.update({
      where: { id: record.id },
      data: { judgeStatus: 'running', judgeError: null },
    })

    const executionContext = this.buildExecutionContext(undefined, undefined)
    try {
      const judged = await this.executor.judgeAnswer({
        prompt: run.prompt,
        expectedAnswer: run.expectedAnswer,
        answer: record.output || '',
        threshold: run.judgeThreshold,
        judgeModel: judgeResolution,
        context: executionContext,
      })

      const updated = await this.prisma.battleResult.update({
        where: { id: record.id },
        data: {
          judgeStatus: 'success',
          judgeError: null,
          judgePass: judged.pass,
          judgeScore: judged.score,
          judgeReason: judged.reason,
          judgeFallbackUsed: judged.fallbackUsed,
          judgeRawJson: safeJsonStringify(judged.raw || {}, '{}'),
        },
      })

      await this.refreshRunSummary(run.id)
      return this.serializeResult(updated)
    } catch (error) {
      const message = error instanceof Error ? error.message : '裁判模型评测失败'
      const updated = await this.prisma.battleResult.update({
        where: { id: record.id },
        data: {
          judgeStatus: 'error',
          judgeError: message,
          judgePass: null,
          judgeScore: null,
          judgeReason: null,
          judgeFallbackUsed: false,
          judgeRawJson: '{}',
        },
      })
      await this.refreshRunSummary(run.id)
      return this.serializeResult(updated)
    }
  }

  async retryJudgeForRun(actor: Actor, params: { runId: number; resultIds?: number[] | null }) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: params.runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }

    const judgeResolution = await this.resolveModel(actor, {
      modelId: run.judgeModelId,
      connectionId: run.judgeConnectionId ?? undefined,
      rawId: run.judgeRawId ?? undefined,
    })
    if (!judgeResolution) {
      throw new Error('Judge model not found')
    }

    const resultIds = Array.isArray(params.resultIds) ? params.resultIds.filter((id) => Number.isFinite(id)) : []
    const scopedIds = resultIds.length > 0 ? Array.from(new Set(resultIds)).slice(0, 200) : null

    const candidates = await this.prisma.battleResult.findMany({
      where: {
        battleRunId: run.id,
        ...(scopedIds ? { id: { in: scopedIds } } : {}),
      },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
      take: scopedIds ? undefined : 200,
    })

    const targets = scopedIds
      ? candidates
      : candidates.filter((item) => {
        if (item.error) return false
        const status = (item as any).judgeStatus as string | undefined
        if (!status) return item.judgePass == null
        return status !== 'success'
      })

    if (targets.length === 0) {
      return { total: 0, updated: 0, skipped: 0, errors: 0, resultIds: [] as number[] }
    }

    await this.prisma.battleResult.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { judgeStatus: 'running', judgeError: null },
    })

    const executionContext = this.buildExecutionContext(undefined, undefined)
    let updatedCount = 0
    let skippedCount = 0
    let errorCount = 0
    const updatedIds: number[] = []

    for (const item of targets) {
      if (item.error) {
        skippedCount += 1
        continue
      }
      try {
        const judged = await this.executor.judgeAnswer({
          prompt: run.prompt,
          expectedAnswer: run.expectedAnswer,
          answer: item.output || '',
          threshold: run.judgeThreshold,
          judgeModel: judgeResolution,
          context: executionContext,
        })
        await this.prisma.battleResult.update({
          where: { id: item.id },
          data: {
            judgeStatus: 'success',
            judgeError: null,
            judgePass: judged.pass,
            judgeScore: judged.score,
            judgeReason: judged.reason,
            judgeFallbackUsed: judged.fallbackUsed,
            judgeRawJson: safeJsonStringify(judged.raw || {}, '{}'),
          },
        })
        updatedCount += 1
        updatedIds.push(item.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : '裁判模型评测失败'
        await this.prisma.battleResult.update({
          where: { id: item.id },
          data: {
            judgeStatus: 'error',
            judgeError: message,
            judgePass: null,
            judgeScore: null,
            judgeReason: null,
            judgeFallbackUsed: false,
            judgeRawJson: '{}',
          },
        })
        errorCount += 1
        updatedIds.push(item.id)
      }
    }

    await this.refreshRunSummary(run.id)
    return { total: targets.length, updated: updatedCount, skipped: skippedCount, errors: errorCount, resultIds: updatedIds }
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

  private async refreshRunSummary(runId: number) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId },
      select: { id: true, runsPerModel: true, passK: true, judgeThreshold: true },
    })
    if (!run) return
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const summary = this.buildSummary(results as BattleResultRecord[], run.runsPerModel, run.passK, run.judgeThreshold)
    await this.prisma.battleRun.update({
      where: { id: run.id },
      data: { summaryJson: safeJsonStringify(summary, '{}') },
    })
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
    options?: { emitEvent?: (event: BattleStreamEvent) => void },
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
      models: input.models.map((model) => {
        const extraPrompt = typeof model.extraPrompt === 'string' ? model.extraPrompt.trim() : ''
        return {
          modelId: model.modelId,
          connectionId: model.connectionId ?? null,
          rawId: model.rawId ?? null,
          features: model.features ?? {},
          ...(extraPrompt ? { extraPrompt } : {}),
          customHeaders: normalizeCustomHeadersForConfig(model.custom_headers),
          customBody: normalizeCustomBodyForConfig(model.custom_body),
          reasoningEnabled: typeof model.reasoningEnabled === 'boolean' ? model.reasoningEnabled : null,
          reasoningEffort: normalizeReasoningEffort(model.reasoningEffort),
          ollamaThink: typeof model.ollamaThink === 'boolean' ? model.ollamaThink : null,
        }
      }),
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
    let traceFinalStatus: TaskTraceStatus | null = null
    let traceFinalError: string | null = null

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
      runControl.traceRecorder?.log('battle:run_cancelled', {
        runId: run.id,
        reason: 'start_cancelled',
      })
      traceFinalStatus = 'cancelled'
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

      const systemSettings = await this.loadSystemSettings()
      const maxConcurrency = this.normalizeConcurrency(input.maxConcurrency)
      const traceDecision = await shouldEnableTaskTrace({ actor, sysMap: systemSettings })
      runControl.traceRecorder = await TaskTraceRecorder.create({
        enabled: traceDecision.enabled,
        actorIdentifier: actor.identifier,
        traceLevel: traceDecision.traceLevel,
        metadata: {
          feature: 'battle',
          runId: run.id,
          title: run.title,
          promptPreview: truncateString(input.prompt || '', 200),
          expectedAnswerPreview: truncateString(input.expectedAnswer || '', 200),
          runsPerModel: input.runsPerModel,
          passK: input.passK,
          judgeThreshold,
          maxConcurrency,
          modelCount: input.models.length,
          judge: {
            modelId: input.judge.modelId,
            connectionId: input.judge.connectionId ?? null,
            rawId: input.judge.rawId ?? null,
          },
          models: input.models.map((model) => ({
            modelId: model.modelId,
            connectionId: model.connectionId ?? null,
            rawId: model.rawId ?? null,
            features: model.features ? {
              web_search: model.features.web_search === true,
              python_tool: model.features.python_tool === true,
            } : undefined,
            reasoningEnabled: typeof model.reasoningEnabled === 'boolean' ? model.reasoningEnabled : undefined,
            reasoningEffort: model.reasoningEffort || undefined,
            ollamaThink: typeof model.ollamaThink === 'boolean' ? model.ollamaThink : undefined,
          })),
        },
        maxEvents: traceDecision.config.maxEvents,
      })
      runControl.traceRecorder?.log('battle:run_start', {
        runId: run.id,
        title: run.title,
      })

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
        runControl.traceRecorder?.log('battle:run_cancelled', {
          runId: run.id,
          reason: 'run_cancelled',
        })
        traceFinalStatus = 'cancelled'
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
          runControl.traceRecorder?.log('battle:run_cancelled', {
            runId: run.id,
            reason: 'status_cancelled',
          })
          traceFinalStatus = 'cancelled'
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
      runControl.traceRecorder?.log('battle:run_complete', {
        runId: run.id,
        passModelCount: summary.passModelCount,
        totalModels: summary.totalModels,
        accuracy: summary.accuracy,
      })
      traceFinalStatus = 'completed'

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
        runControl.traceRecorder?.log('battle:run_cancelled', {
          runId: run.id,
          reason: 'cancelled_in_error',
        })
        traceFinalStatus = 'cancelled'
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
      traceFinalStatus = 'error'
      traceFinalError = (error as Error)?.message || 'Battle failed'
      runControl.traceRecorder?.log('battle:run_error', {
        runId: run.id,
        error: traceFinalError,
      })
      throw error
    } finally {
      if (runControl.traceRecorder && traceFinalStatus) {
        await runControl.traceRecorder.finalize(traceFinalStatus, {
          error: traceFinalError,
        })
      }
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
    emitEvent?: (event: BattleStreamEvent) => void,
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
    const traceRecorder = runControl?.traceRecorder
    const attemptTraceContext = this.buildAttemptTraceContext(runControl, attemptKey, {
      modelId,
      connectionId: model.resolved.connection.id,
      rawId: model.resolved.rawModelId,
    })
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
        judgeStatus: 'skipped',
        judgeError: null,
        judge: null,
      })
      traceRecorder?.log('battle:attempt_complete', {
        ...attemptTraceContext,
        status: 'cancelled',
        durationMs: 0,
        error: '已取消',
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

    traceRecorder?.log('battle:attempt_start', {
      ...attemptTraceContext,
      attemptIndex,
      features: model.config.features ? {
        web_search: model.config.features.web_search === true,
        python_tool: model.config.features.python_tool === true,
      } : undefined,
      reasoningEnabled: typeof model.config.reasoningEnabled === 'boolean' ? model.config.reasoningEnabled : undefined,
      reasoningEffort: model.config.reasoningEffort || undefined,
      ollamaThink: typeof model.config.ollamaThink === 'boolean' ? model.config.ollamaThink : undefined,
    })

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
    const executionContext = this.buildExecutionContext(runControl, attemptKey)

    try {
      const runResult = await this.executor.executeModel({
        prompt,
        modelConfig: model.config,
        resolved: model.resolved,
        systemSettings,
        context: executionContext,
        emitDelta: (delta) => {
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
      })
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

    let judgeStatus: 'unknown' | 'running' | 'success' | 'error' | 'skipped' = 'skipped'
    let judgeError: string | null = null
    let judgeResult: { pass: boolean; score: number | null; reason: string | null; fallbackUsed: boolean; raw?: Record<string, any> } | null = null
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
        judgeStatus = 'running'
        judgeResult = await this.executor.judgeAnswer({
          prompt,
          expectedAnswer,
          answer: output,
          threshold: judgeThreshold,
          judgeModel,
          context: executionContext,
        })
        judgeStatus = 'success'
      } catch (judgeError) {
        if (this.isRunCancelled(runControl)) {
          throw new BattleRunCancelledError()
        }
        if (this.isAttemptCancelled(runControl, attemptKey)) {
          judgeStatus = 'skipped'
          judgeError = '已取消'
        } else {
          judgeStatus = 'error'
          judgeError = judgeError instanceof Error ? judgeError.message : '裁判模型评测失败'
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
      judgeStatus: error ? 'skipped' : judgeStatus,
      judgeError: error ? null : judgeError,
      judge: judgeResult,
    })

    if (runControl) {
      this.ensureLiveAttempt(runControl, {
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        attemptIndex,
        status: error ? 'error' : (judgeStatus === 'error' ? 'error' : 'success'),
        output,
        reasoning,
        durationMs,
        error,
      })
    }

    traceRecorder?.log('battle:attempt_complete', {
      ...attemptTraceContext,
      status: error ? 'error' : 'success',
      durationMs,
      error,
      judgePass: judgeResult?.pass ?? null,
      judgeScore: judgeResult?.score ?? null,
      judgeFallbackUsed: judgeResult?.fallbackUsed ?? null,
      judgeStatus: error ? 'skipped' : judgeStatus,
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
    judgeStatus: 'unknown' | 'running' | 'success' | 'error' | 'skipped'
    judgeError: string | null
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
        judgeStatus: params.judgeStatus,
        judgeError: params.judgeError,
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
      judgeStatus: record.judgeStatus ?? 'unknown',
      judgeError: record.judgeError ?? null,
      judgePass: record.judgePass,
      judgeScore: record.judgeScore,
      judgeReason: record.judgeReason,
      judgeFallbackUsed: record.judgeFallbackUsed,
    }
  }

  private buildSummary(results: BattleResultRecord[], runsPerModel: number, passK: number, judgeThreshold: number): BattleRunSummary {
    const groups = new Map<string, {
      modelId: string
      connectionId: number | null
      rawId: string | null
      passCount: number
      judgedCount: number
      totalAttempts: number
      judgeErrorCount: number
    }>()

    for (const result of results) {
      const key = `${result.modelId}:${result.connectionId ?? 'null'}:${result.rawId ?? 'null'}`
      const group = groups.get(key) || {
        modelId: result.modelId,
        connectionId: result.connectionId ?? null,
        rawId: result.rawId ?? null,
        passCount: 0,
        judgedCount: 0,
        totalAttempts: 0,
        judgeErrorCount: 0,
      }
      group.totalAttempts += 1
      const status = (result as any).judgeStatus as string | undefined
      if (status === 'error') {
        group.judgeErrorCount += 1
      }
      const judged = result.judgePass != null && status !== 'error'
      if (judged) {
        group.judgedCount += 1
        if (result.judgePass === true) {
          group.passCount += 1
        }
      }
      groups.set(key, group)
    }

    const modelStats = Array.from(groups.values()).map((group) => {
      // 使用 totalAttempts 作为分母计算准确率，这样错误的尝试也会被计入
      // 确保统计的公平性：无论是模型报错还是裁判失败，都应该算作未通过
      const accuracy = group.totalAttempts > 0 ? group.passCount / group.totalAttempts : 0
      return {
        modelId: group.modelId,
        connectionId: group.connectionId,
        rawId: group.rawId,
        passAtK: group.passCount >= passK,
        passCount: group.passCount,
        accuracy,
        judgedCount: group.judgedCount,
        totalAttempts: group.totalAttempts,
        judgeErrorCount: group.judgeErrorCount,
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
      traceRecorder: null,
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

  private buildExecutionContext(runControl?: BattleRunControl, attemptKey?: string): BattleExecutionContext {
    return {
      checkRunCancelled: () => this.throwIfRunCancelled(runControl),
      checkAttemptCancelled: () => {
        if (attemptKey) {
          this.throwIfAttemptCancelled(runControl, attemptKey)
        }
      },
      buildAbortHandlers: () => this.buildAbortHandlers(runControl, attemptKey),
      traceRecorder: runControl?.traceRecorder ?? null,
      buildTraceContext: (extra) => this.buildAttemptTraceContext(runControl, attemptKey, extra),
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

  private buildAttemptTraceContext(
    runControl?: BattleRunControl,
    attemptKey?: string,
    extra?: Record<string, unknown>,
  ) {
    const context: Record<string, unknown> = {}
    if (runControl?.runId != null) {
      context.runId = runControl.runId
    }
    if (attemptKey) {
      const splitIndex = attemptKey.lastIndexOf('#')
      if (splitIndex > 0) {
        const modelKey = attemptKey.slice(0, splitIndex)
        const attemptIndexRaw = attemptKey.slice(splitIndex + 1)
        const attemptIndex = Number.parseInt(attemptIndexRaw, 10)
        context.modelKey = modelKey
        if (Number.isFinite(attemptIndex)) {
          context.attemptIndex = attemptIndex
        }
      }
      context.attemptKey = attemptKey
    }
    if (extra) {
      return { ...context, ...extra }
    }
    return context
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
