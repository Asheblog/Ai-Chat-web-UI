import crypto from 'node:crypto'
import type { Prisma, PrismaClient, Connection } from '@prisma/client'
import type { Actor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import type { ModelResolverService } from '../catalog/model-resolver-service'
import { consumeBattleQuota } from '../../utils/battle-quota'
import { getBattlePolicy } from '../../utils/system-settings'
import { TaskTraceRecorder, shouldEnableTaskTrace, truncateString, type TaskTraceStatus } from '../../utils/task-trace'
import {
  parseCapabilityEnvelope,
} from '../../utils/capabilities'
import type {
  BattleMode,
  BattleContent,
  BattleContentInput,
  BattleRunStatus,
  BattleStreamEvent,
  BattleToolCallEvent,
  BattleUploadImage,
  RejudgeExpectedAnswerInput,
  RejudgeStreamEvent,
} from '@aichat/shared/battle-contract'
import { BattleExecutor, type BattleExecutionContext } from './battle-executor'
import { safeJsonStringify, safeParseJson } from './battle-serialization'
import type { BattleImageService } from './battle-image-service'
import { BattleRetentionCleanupService } from './battle-retention-cleanup-service'
import { BattleSummaryProjector } from './battle-summary-projector'
import { BattleShareProjector } from './battle-share-projector'
import { createLogger } from '../../utils/logger'
import type {
  BattleQuestionInput,
  BattleModelSkills,
  BattleModelInput,
  BattleRunConfig,
  BattleRunConfigModel,
  BattleRunQuestionConfig,
  BattleRunCreateInput,
  BattleRunCreateSingleModelInput,
  BattleRunRecord,
  BattleRunSummary,
  BattleShareDetail,
  BattleSharePayload,
  BattleResultRecord,
} from './battle-types'
import { BUILTIN_SKILL_SLUGS } from '../../modules/skills/types'
import { normalizeToolCallEventPayload } from '../../modules/chat/tool-call-event'

type BattleRunControl = {
  runId: number
  actorUserId: number | null
  actorIdentifier: string
  abortController: AbortController
  requestControllers: Set<AbortController>
  attemptControllers: Map<string, Set<AbortController>>
  cancelledAttempts: Set<string>
  attemptEpochs: Map<string, number>
  liveAttempts: Map<string, Map<string, LiveAttemptState>>
  taskGroups: Map<string, { queue: AttemptTask[]; running: boolean }>
  traceRecorder?: TaskTraceRecorder | null
  scheduler?: {
    enqueue: (taskGroupKey: string, task: AttemptTask) => boolean
    isClosed: () => boolean
  }
  emitEvent?: (event: BattleStreamEvent) => void
  eventListeners: Set<(event: BattleStreamEvent) => void>
  runContext?: {
    mode: BattleMode
    prompt: string
    expectedAnswer: string
    promptImages: BattleUploadImage[]
    expectedAnswerImages: BattleUploadImage[]
    promptImagePaths?: string[]
    expectedAnswerImagePaths?: string[]
    judgeThreshold: number
    judgeModel: { connection: Connection; rawModelId: string }
    systemSettings: Record<string, string>
    singleModel?: {
      model: { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }
      questions: BattleRunQuestionConfig[]
    }
  }
  resolvedModels?: Map<string, { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }>
  cancelled: boolean
}

type LiveAttemptState = {
  questionIndex: number
  questionId: string | null
  questionTitle: string | null
  modelId: string
  connectionId: number | null
  rawId: string | null
  attemptIndex: number
  status: 'pending' | 'running' | 'success' | 'error' | 'judging'
  output: string
  reasoning: string
  durationMs: number | null
  error: string | null
  toolEvents: BattleToolCallEvent[]
}

type AttemptTask = {
  taskGroupKey: string
  modelKey: string
  attemptKey: string
  questionIndex: number
  questionId: string | null
  questionTitle: string | null
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
  modelResolver: ModelResolverService
  executor?: BattleExecutor
  imageService: BattleImageService
  retentionCleanupService?: BattleRetentionCleanupService
}

const DEFAULT_JUDGE_THRESHOLD = 0.8
const log = createLogger('BattleService')

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

const normalizeConfigSkills = (raw: unknown): BattleModelSkills | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const data = raw as Record<string, any>

  const enabledFromPayload = Array.isArray(data.enabled)
    ? data.enabled
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter((item) => item.length > 0)
    : []

  const legacyEnabled: string[] = []
  if (data.web_search === true) legacyEnabled.push(BUILTIN_SKILL_SLUGS.WEB_SEARCH)
  if (data.python_tool === true) legacyEnabled.push(BUILTIN_SKILL_SLUGS.PYTHON_RUNNER)

  const enabled = Array.from(new Set([...enabledFromPayload, ...legacyEnabled]))
  const overrides =
    data.overrides && typeof data.overrides === 'object' && !Array.isArray(data.overrides)
      ? (data.overrides as Record<string, Record<string, unknown>>)
      : undefined

  if (enabled.length === 0 && !overrides) return undefined
  return {
    enabled,
    ...(overrides ? { overrides } : {}),
  }
}

const normalizeReasoningEffort = (value: unknown): 'low' | 'medium' | 'high' | null => {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value
  }
  return null
}

const normalizeConfigModels = (raw: unknown): BattleRunConfigModel[] => {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
  const rawModels = Array.isArray(data.models) ? data.models : []
  return rawModels
    .map((item): BattleRunConfigModel | null => {
      if (!item || typeof item !== 'object') return null
      const model = item as Record<string, any>
      const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''
      if (!modelId) return null
      const skills = normalizeConfigSkills(model.skills ?? model.features)
      const customHeaders = normalizeCustomHeadersForConfig(
        Array.isArray(model.customHeaders)
          ? model.customHeaders
          : model.custom_headers,
      )
      const customBody = normalizeCustomBodyForConfig(
        (model.customBody ?? model.custom_body) as
          | Record<string, any>
          | null
          | undefined,
      )
      const extraPromptRaw = model.extraPrompt
      const extraPrompt = typeof extraPromptRaw === 'string' ? extraPromptRaw.trim() : ''
      const reasoningEnabled =
        typeof model.reasoningEnabled === 'boolean'
          ? model.reasoningEnabled
          : null
      const reasoningEffort = normalizeReasoningEffort(model.reasoningEffort)
      const ollamaThink =
        typeof model.ollamaThink === 'boolean'
          ? model.ollamaThink
          : null
      return {
        modelId,
        connectionId: isFiniteNumber(model.connectionId) ? model.connectionId : null,
        rawId: typeof model.rawId === 'string' && model.rawId.trim().length > 0 ? model.rawId.trim() : null,
        ...(skills ? { skills } : {}),
        ...(extraPrompt ? { extraPrompt } : {}),
        ...(customHeaders.length > 0 ? { customHeaders } : {}),
        ...(customBody ? { customBody } : {}),
        reasoningEnabled,
        reasoningEffort,
        ollamaThink,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

const normalizeConfigModel = (raw: unknown): BattleRunConfigModel | null => {
  if (!raw || typeof raw !== 'object') return null
  const model = raw as Record<string, any>
  const modelId = typeof model.modelId === 'string' ? model.modelId.trim() : ''
  if (!modelId) return null
  const skills = normalizeConfigSkills(model.skills ?? model.features)
  const customHeaders = normalizeCustomHeadersForConfig(
    Array.isArray(model.customHeaders) ? model.customHeaders : model.custom_headers,
  )
  const customBody = normalizeCustomBodyForConfig(
    (model.customBody ?? model.custom_body) as
      | Record<string, any>
      | null
      | undefined,
  )
  const extraPromptRaw = model.extraPrompt
  const extraPrompt = typeof extraPromptRaw === 'string' ? extraPromptRaw.trim() : ''
  const reasoningEnabled =
    typeof model.reasoningEnabled === 'boolean'
      ? model.reasoningEnabled
      : null
  const reasoningEffort = normalizeReasoningEffort(model.reasoningEffort)
  const ollamaThink =
    typeof model.ollamaThink === 'boolean'
      ? model.ollamaThink
      : null
  return {
    modelId,
    connectionId: isFiniteNumber(model.connectionId) ? model.connectionId : null,
    rawId: typeof model.rawId === 'string' && model.rawId.trim().length > 0 ? model.rawId.trim() : null,
    ...(skills ? { skills } : {}),
    ...(extraPrompt ? { extraPrompt } : {}),
    ...(customHeaders.length > 0 ? { customHeaders } : {}),
    ...(customBody ? { customBody } : {}),
    reasoningEnabled,
    reasoningEffort,
    ollamaThink,
  }
}

const normalizeQuestionConfig = (raw: unknown): BattleRunQuestionConfig | null => {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, any>
  const questionIndex = isFiniteNumber(item.questionIndex) ? Math.max(1, Math.floor(item.questionIndex)) : null
  const prompt = item.prompt && typeof item.prompt === 'object'
    ? {
      text: normalizeBattleText((item.prompt as Record<string, unknown>).text),
      images: Array.isArray((item.prompt as Record<string, unknown>).images)
        ? ((item.prompt as Record<string, unknown>).images as unknown[]).map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    }
    : { text: '', images: [] }
  const expectedAnswer = item.expectedAnswer && typeof item.expectedAnswer === 'object'
    ? {
      text: normalizeBattleText((item.expectedAnswer as Record<string, unknown>).text),
      images: Array.isArray((item.expectedAnswer as Record<string, unknown>).images)
        ? ((item.expectedAnswer as Record<string, unknown>).images as unknown[]).map((entry) => String(entry || '').trim()).filter(Boolean)
        : [],
    }
    : { text: '', images: [] }
  if (!questionIndex) return null
  return {
    questionIndex,
    questionId: typeof item.questionId === 'string' && item.questionId.trim() ? item.questionId.trim() : null,
    title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
    prompt,
    expectedAnswer,
    runsPerQuestion: isFiniteNumber(item.runsPerQuestion) ? Math.max(1, Math.floor(item.runsPerQuestion)) : 1,
    passK: isFiniteNumber(item.passK) ? Math.max(1, Math.floor(item.passK)) : 1,
  }
}

const normalizeConfigQuestions = (raw: unknown): BattleRunQuestionConfig[] => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => normalizeQuestionConfig(item))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.questionIndex - b.questionIndex)
}

const parseRunConfigPayload = (raw: string | null | undefined) =>
  safeParseJson<Record<string, any>>(raw || '{}', {})

type LabelConnection = {
  id: number
  prefixId: string | null
}

const buildRunTitle = (prompt: string, explicit?: string) => {
  const trimmed = (explicit || '').trim()
  if (trimmed) return trimmed
  const base = (prompt || '').trim()
  if (!base) return '模型大乱斗'
  return base.length > 30 ? `${base.slice(0, 30)}…` : base
}

const composeModelLabel = (
  connection: Pick<LabelConnection, 'prefixId'> | null,
  rawId?: string | null,
  fallback?: string | null,
) => {
  const raw = (rawId || '').trim()
  const prefix = (connection?.prefixId || '').trim()
  if (raw && prefix) return `${prefix}.${raw}`
  if (raw) return raw
  return fallback || null
}

const normalizeRunStatus = (value: string | null | undefined): BattleRunStatus => {
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'error' || value === 'cancelled') {
    return value
  }
  return 'error'
}

const normalizeBattleMode = (value: unknown): BattleMode => {
  if (value === 'single_model_multi_question') return 'single_model_multi_question'
  return 'multi_model'
}

const buildModelKey = (modelId: string, connectionId?: number | null, rawId?: string | null) => {
  if (typeof connectionId === 'number' && rawId) {
    return `${connectionId}:${rawId}`
  }
  return `global:${modelId}`
}

const buildAttemptKey = (modelKey: string, questionIndex: number, attemptIndex: number) =>
  `${modelKey}#q${questionIndex}#${attemptIndex}`

const parseImagePathsJson = (raw: string | null | undefined) => {
  const parsed = safeParseJson<unknown>(raw || '[]', [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
}

const normalizeBattleText = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '')

const isBattleContentEmpty = (content: BattleContentInput) => {
  const text = normalizeBattleText(content.text)
  const hasImages = Array.isArray(content.images) && content.images.length > 0
  return !text && !hasImages
}

const TOOL_EVENT_STATUS_VALUES = new Set([
  'running',
  'success',
  'error',
  'pending',
  'rejected',
  'aborted',
])

const TOOL_EVENT_PHASE_VALUES = new Set([
  'arguments_streaming',
  'pending_approval',
  'executing',
  'result',
  'error',
  'rejected',
  'aborted',
])

const TOOL_EVENT_SOURCE_VALUES = new Set(['builtin', 'plugin', 'mcp', 'workspace', 'system'])

const TOOL_EVENT_STAGE_VALUES = new Set(['start', 'result', 'error'])

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const pickString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length > 0) return trimmed
    }
  }
  return null
}

const toTimestamp = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

const normalizeBattleToolCallEvent = (payload: Record<string, unknown>): BattleToolCallEvent | null => {
  const normalized = normalizeToolCallEventPayload(payload)
  const details = asRecord(normalized.details) || undefined
  const now = Date.now()
  const createdAt = toTimestamp(normalized.createdAt, now)
  const updatedAt = toTimestamp(normalized.updatedAt, createdAt)

  const callId = pickString(normalized.callId, normalized.id)
  const id = pickString(normalized.id, normalized.callId) || `tool-${createdAt}`
  if (!id) return null

  const status = TOOL_EVENT_STATUS_VALUES.has(String(normalized.status))
    ? (normalized.status as BattleToolCallEvent['status'])
    : 'running'
  const phase = TOOL_EVENT_PHASE_VALUES.has(String(normalized.phase))
    ? (normalized.phase as BattleToolCallEvent['phase'])
    : undefined
  const source = TOOL_EVENT_SOURCE_VALUES.has(String(normalized.source))
    ? (normalized.source as BattleToolCallEvent['source'])
    : undefined
  const stage = TOOL_EVENT_STAGE_VALUES.has(String(normalized.stage))
    ? (normalized.stage as BattleToolCallEvent['stage'])
    : undefined
  const identifier = pickString(normalized.identifier, normalized.tool) || undefined
  const apiName = pickString(normalized.apiName, normalized.identifier, normalized.tool) || undefined
  const tool = pickString(normalized.tool, normalized.identifier) || undefined
  const query = pickString(normalized.query) || undefined
  const argumentsText = pickString(normalized.argumentsText, details?.argumentsText, details?.input, details?.code) || undefined
  const argumentsPatch = pickString(normalized.argumentsPatch, details?.argumentsPatch) || undefined
  const resultText = pickString(normalized.resultText, details?.resultText, details?.stdout, details?.excerpt) || undefined
  const error = pickString(normalized.error) || undefined
  const summary = pickString(normalized.summary) || undefined

  const event: BattleToolCallEvent = {
    id,
    status,
    createdAt,
    updatedAt,
    ...(callId ? { callId } : {}),
    ...(source ? { source } : {}),
    ...(stage ? { stage } : {}),
    ...(phase ? { phase } : {}),
    ...(identifier ? { identifier } : {}),
    ...(apiName ? { apiName } : {}),
    ...(tool ? { tool } : {}),
    ...(query ? { query } : {}),
    ...(Array.isArray(normalized.hits) ? { hits: normalized.hits as BattleToolCallEvent['hits'] } : {}),
    ...(argumentsText ? { argumentsText } : {}),
    ...(argumentsPatch ? { argumentsPatch } : {}),
    ...(resultText ? { resultText } : {}),
    ...(typeof normalized.resultJson !== 'undefined' ? { resultJson: normalized.resultJson } : {}),
    ...(error ? { error } : {}),
    ...(summary ? { summary } : {}),
    ...(details ? { details: details as BattleToolCallEvent['details'] } : {}),
    ...(asRecord(normalized.intervention)
      ? { intervention: normalized.intervention as BattleToolCallEvent['intervention'] }
      : {}),
    ...(typeof normalized.thoughtSignature === 'string' || normalized.thoughtSignature === null
      ? { thoughtSignature: normalized.thoughtSignature as string | null }
      : {}),
  }

  return event
}

const buildToolEventKey = (event: BattleToolCallEvent) => {
  const callId = pickString(event.callId)
  if (callId) return `call:${callId}`
  const id = pickString(event.id)
  if (id) return `id:${id}`
  return `fallback:${event.createdAt}`
}

const mergeToolEvent = (
  previous: BattleToolCallEvent,
  incoming: BattleToolCallEvent,
): BattleToolCallEvent => ({
  ...previous,
  ...incoming,
  id: incoming.id || previous.id,
  callId: incoming.callId || previous.callId,
  createdAt: Math.min(previous.createdAt, incoming.createdAt),
  updatedAt: Math.max(previous.updatedAt ?? previous.createdAt, incoming.updatedAt ?? incoming.createdAt),
  details:
    previous.details || incoming.details
      ? { ...(previous.details || {}), ...(incoming.details || {}) }
      : undefined,
})

const compareToolEvents = (a: BattleToolCallEvent, b: BattleToolCallEvent) => {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
  const aUpdated = a.updatedAt ?? a.createdAt
  const bUpdated = b.updatedAt ?? b.createdAt
  if (aUpdated !== bUpdated) return aUpdated - bUpdated
  return buildToolEventKey(a).localeCompare(buildToolEventKey(b))
}

export class BattleService {
  private prisma: PrismaClient
  private modelResolver: ModelResolverService
  private executor: BattleExecutor
  private imageService: BattleImageService
  private retentionCleanupService: BattleRetentionCleanupService
  private summaryProjector: BattleSummaryProjector
  private shareProjector: BattleShareProjector
  private activeRuns = new Map<number, BattleRunControl>()
  private vacuumInFlight: Promise<void> | null = null

  constructor(deps: BattleServiceDeps) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.modelResolver = deps.modelResolver
    this.executor = deps.executor ?? new BattleExecutor()
    this.imageService = deps.imageService
    this.retentionCleanupService =
      deps.retentionCleanupService ??
      new BattleRetentionCleanupService({
        prisma: this.prisma,
        imageService: this.imageService,
        scheduleVacuum: () => {
          this.scheduleAsyncVacuum()
        },
      })
    this.summaryProjector = new BattleSummaryProjector({
      normalizeMode: normalizeBattleMode,
    })
    this.shareProjector = new BattleShareProjector({
      parseRunConfigPayload,
      normalizeMode: normalizeBattleMode,
      normalizeQuestions: normalizeConfigQuestions,
      parseImagePaths: parseImagePathsJson,
      toBattleContent: (text, imagePaths) => this.toBattleContent(text, imagePaths),
      composeModelLabel,
      normalizeRunStatus,
      safeParseUsage: (raw) => safeParseJson(raw, {} as Record<string, any>),
      buildAttemptKey,
      buildModelKey,
    })
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
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const rawConfig = safeParseJson<Record<string, any>>(run.configJson, {})
    const configMode = normalizeBattleMode(rawConfig.mode ?? run.mode)
    const configModels = normalizeConfigModels(rawConfig)
    const configModel = normalizeConfigModel(rawConfig.model)
    const configQuestions = normalizeConfigQuestions(rawConfig.questions)
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
    const config: BattleRunConfig = configMode === 'single_model_multi_question'
      ? {
        mode: 'single_model_multi_question',
        ...(configModel
          ? { model: configModel }
          : (Array.from(fallbackModels.values())[0]
            ? { model: Array.from(fallbackModels.values())[0] }
            : {})),
        questions: configQuestions,
      }
      : {
        mode: 'multi_model',
        models: configModels.length > 0 ? configModels : Array.from(fallbackModels.values()),
      }
    const connectionIds = Array.from(
      new Set(
        [
          ...results.map((item) => item.connectionId),
          ...configModels.map((item) => item.connectionId),
          configModel?.connectionId ?? null,
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
    let summary = this.summaryProjector.normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })
    const shouldRebuildSummary =
      results.length > 0 && (summary.modelStats.length === 0 || summary.totalModels === 0)
    if (shouldRebuildSummary) {
      summary = this.summaryProjector.buildSummary(
        results as BattleResultRecord[],
        run.runsPerModel,
        run.passK,
        run.judgeThreshold,
        {
          mode: configMode,
          questionConfigs: configQuestions,
        },
      )
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
        questionIndex: item.questionIndex ?? 1,
        questionId: item.questionId ?? null,
        questionTitle: item.questionTitle ?? null,
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
      select: { id: true, promptImagesJson: true, expectedAnswerImagesJson: true },
    })
    if (!existing) return false

    this.cancelRunControl(existing.id, 'run_deleted')

    const imagePaths = this.collectUniqueBattleImagePaths([existing])
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.battleShare.deleteMany({ where: { battleRunId: existing.id } })
      await tx.battleResult.deleteMany({ where: { battleRunId: existing.id } })
      const runResult = await tx.battleRun.deleteMany({ where: { id: existing.id } })
      return runResult.count
    })

    if (result > 0) {
      await this.imageService.deleteImages(imagePaths)
      return true
    }
    return false
  }

  async clearAllRunsAndSharesGlobal(actor: Actor) {
    if (actor.type !== 'user' || actor.role !== 'ADMIN') {
      throw new Error('Admin access required')
    }

    for (const runId of Array.from(this.activeRuns.keys())) {
      this.cancelRunControl(runId, 'admin_clear_all')
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const runs = await tx.battleRun.findMany({
        select: { id: true, promptImagesJson: true, expectedAnswerImagesJson: true },
      })
      const imagePaths = this.collectUniqueBattleImagePaths(runs)
      const deletedShares = await tx.battleShare.deleteMany({})
      const deletedResults = await tx.battleResult.deleteMany({})
      const deletedRuns = await tx.battleRun.deleteMany({})
      return {
        deletedRuns: deletedRuns.count,
        deletedResults: deletedResults.count,
        deletedShares: deletedShares.count,
        imagePaths,
      }
    })

    await this.imageService.deleteImages(result.imagePaths)

    const deletedImages = result.imagePaths.length
    const hasDeletion =
      result.deletedRuns > 0 ||
      result.deletedResults > 0 ||
      result.deletedShares > 0 ||
      deletedImages > 0
    const vacuumScheduled = hasDeletion ? this.scheduleAsyncVacuum() : false

    return {
      deletedRuns: result.deletedRuns,
      deletedResults: result.deletedResults,
      deletedShares: result.deletedShares,
      deletedImages,
      vacuumScheduled,
      vacuumMode: 'async' as const,
    }
  }

  async triggerRetentionCleanupIfDue() {
    await this.retentionCleanupService.triggerIfDue()
  }

  async cancelRun(actor: Actor, runId: number) {
    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) return null

    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const configPayload = parseRunConfigPayload(run.configJson)
    const summary = this.summaryProjector.buildSummary(
      results as BattleResultRecord[],
      run.runsPerModel,
      run.passK,
      run.judgeThreshold,
      {
        mode: normalizeBattleMode(configPayload.mode ?? run.mode),
        questionConfigs: normalizeConfigQuestions(configPayload.questions),
      },
    )

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
    params: {
      runId: number
      modelId?: string | null
      connectionId?: number | null
      rawId?: string | null
      questionIndex?: number | null
      attemptIndex: number
    },
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

    const live = this.getLiveAttempt(runControl, target.modelKey, target.questionIndex, params.attemptIndex)
    if (live && (live.status === 'success' || live.status === 'error')) {
      throw new Error('Attempt already completed')
    }

    const existing = await this.prisma.battleResult.findFirst({
      where: {
        battleRunId: run.id,
        questionIndex: target.questionIndex,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })
    if (existing && !existing.error) {
      throw new Error('Attempt already completed')
    }

    const attemptKey = buildAttemptKey(target.modelKey, target.questionIndex, params.attemptIndex)
    this.cancelAttemptControl(runControl, {
      attemptKey,
      modelId: target.modelId,
      connectionId: target.connectionId,
      rawId: target.rawId,
      questionIndex: target.questionIndex,
      questionId: target.questionId,
      questionTitle: target.questionTitle,
      attemptIndex: params.attemptIndex,
    })

    const isRunning = live?.status === 'running' || live?.status === 'judging'
    if (isRunning) {
      return { status: 'cancelling' as const }
    }

    if (!existing) {
      const group = runControl.taskGroups.get(target.taskGroupKey)
      if (group) {
        group.queue = group.queue.filter((task) => task.attemptKey !== attemptKey)
      }
      const modelEntry = runControl.resolvedModels?.get(target.modelKey)
      if (!modelEntry) {
        throw new Error('Attempt model not found')
      }
      const record = await this.persistResult({
        battleRunId: run.id,
        questionIndex: target.questionIndex,
        questionId: target.questionId,
        questionTitle: target.questionTitle,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
        skills: modelEntry.config.skills,
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
          questionIndex: target.questionIndex,
          questionId: target.questionId,
          questionTitle: target.questionTitle,
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
    params: {
      runId: number
      modelId?: string | null
      connectionId?: number | null
      rawId?: string | null
      questionIndex?: number | null
      attemptIndex: number
    },
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

    const live = this.getLiveAttempt(runControl, target.modelKey, target.questionIndex, params.attemptIndex)
    if (live && (live.status === 'running' || live.status === 'judging' || live.status === 'pending')) {
      throw new Error('Attempt is still running')
    }

    const existing = await this.prisma.battleResult.findFirst({
      where: {
        battleRunId: run.id,
        questionIndex: target.questionIndex,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })
    if (!existing || !existing.error) {
      throw new Error('Attempt is not failed')
    }

    const attemptKey = buildAttemptKey(target.modelKey, target.questionIndex, params.attemptIndex)
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
        questionIndex: target.questionIndex,
        modelId: target.modelId,
        connectionId: target.connectionId,
        rawId: target.rawId,
        attemptIndex: params.attemptIndex,
      },
    })

    const remainingResults = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const refreshedSummary = this.summaryProjector.buildSummary(
      remainingResults as BattleResultRecord[],
      run.runsPerModel,
      run.passK,
      run.judgeThreshold,
      {
        mode: normalizeBattleMode(target.mode ?? run.mode),
        questionConfigs: target.questionConfigs,
      },
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
      questionIndex: target.questionIndex,
      questionId: target.questionId,
      questionTitle: target.questionTitle,
      modelId: target.modelId,
      connectionId: target.connectionId,
      rawId: target.rawId,
      attemptIndex: params.attemptIndex,
      status: 'pending',
      output: '',
      reasoning: '',
      durationMs: null,
      error: null,
      toolEvents: [],
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

    const group = runControl.taskGroups.get(target.taskGroupKey)
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
      question: target.question,
      attemptIndex: params.attemptIndex,
      runControl,
    })
    if (task.attemptEpoch !== nextEpoch) {
      task.attemptEpoch = nextEpoch
    }
    if (!scheduler.enqueue(target.taskGroupKey, task)) {
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

    const configPayload = parseRunConfigPayload(run.configJson)
    const mode = normalizeBattleMode(configPayload.mode ?? run.mode)
    const questionConfigs = normalizeConfigQuestions(configPayload.questions)
    const questionConfig = mode === 'single_model_multi_question'
      ? questionConfigs.find((item) => item.questionIndex === (record.questionIndex ?? 1))
      : null
    const promptText = questionConfig?.prompt.text ?? run.prompt
    const expectedAnswerText = questionConfig?.expectedAnswer.text ?? run.expectedAnswer
    const promptImagePaths = questionConfig?.prompt.images ?? parseImagePathsJson(run.promptImagesJson)
    const expectedAnswerImagePaths = questionConfig?.expectedAnswer.images ?? parseImagePathsJson(run.expectedAnswerImagesJson)
    await this.ensureVisionCapabilities({
      judge: {
        modelId: run.judgeModelId,
        resolved: judgeResolution,
      },
      models: [],
      promptHasImages: promptImagePaths.length > 0,
      expectedAnswerHasImages: expectedAnswerImagePaths.length > 0,
    })
    const promptImages = await this.imageService.loadImages(promptImagePaths)
    const expectedAnswerImages = await this.imageService.loadImages(expectedAnswerImagePaths)

    const executionContext = this.buildExecutionContext(undefined, undefined)
    try {
      const judged = await this.executor.judgeAnswer({
        prompt: promptText,
        promptImages,
        expectedAnswer: expectedAnswerText,
        expectedAnswerImages,
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
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
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

    const configPayload = parseRunConfigPayload(run.configJson)
    const mode = normalizeBattleMode(configPayload.mode ?? run.mode)
    const questionConfigs = normalizeConfigQuestions(configPayload.questions)
    const questionConfigMap = new Map<number, BattleRunQuestionConfig>()
    for (const question of questionConfigs) {
      questionConfigMap.set(question.questionIndex, question)
    }

    const defaultPromptImagePaths = parseImagePathsJson(run.promptImagesJson)
    const defaultExpectedImagePaths = parseImagePathsJson(run.expectedAnswerImagesJson)
    await this.ensureVisionCapabilities({
      judge: {
        modelId: run.judgeModelId,
        resolved: judgeResolution,
      },
      models: [],
      promptHasImages: defaultPromptImagePaths.length > 0,
      expectedAnswerHasImages: defaultExpectedImagePaths.length > 0,
    })
    const defaultPromptImages = await this.imageService.loadImages(defaultPromptImagePaths)
    const defaultExpectedImages = await this.imageService.loadImages(defaultExpectedImagePaths)
    const singleQuestionCache = new Map<number, {
      prompt: string
      expectedAnswer: string
      promptImages: BattleUploadImage[]
      expectedAnswerImages: BattleUploadImage[]
    }>()

    const resolveQuestionJudgeContext = async (item: BattleResultRecord) => {
      if (mode !== 'single_model_multi_question') {
        return {
          prompt: run.prompt,
          expectedAnswer: run.expectedAnswer,
          promptImages: defaultPromptImages,
          expectedAnswerImages: defaultExpectedImages,
        }
      }
      const index = item.questionIndex ?? 1
      const cached = singleQuestionCache.get(index)
      if (cached) return cached
      const question = questionConfigMap.get(index)
      if (!question) {
        throw new Error(`Question config not found for questionIndex=${index}`)
      }
      await this.ensureVisionCapabilities({
        judge: {
          modelId: run.judgeModelId,
          resolved: judgeResolution,
        },
        models: [],
        promptHasImages: question.prompt.images.length > 0,
        expectedAnswerHasImages: question.expectedAnswer.images.length > 0,
      })
      const promptImages = await this.imageService.loadImages(question.prompt.images)
      const expectedAnswerImages = await this.imageService.loadImages(question.expectedAnswer.images)
      const context = {
        prompt: question.prompt.text,
        expectedAnswer: question.expectedAnswer.text,
        promptImages,
        expectedAnswerImages,
      }
      singleQuestionCache.set(index, context)
      return context
    }

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
        const questionContext = await resolveQuestionJudgeContext(item as BattleResultRecord)
        const judged = await this.executor.judgeAnswer({
          prompt: questionContext.prompt,
          promptImages: questionContext.promptImages,
          expectedAnswer: questionContext.expectedAnswer,
          expectedAnswerImages: questionContext.expectedAnswerImages,
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

  async rejudgeWithNewAnswer(
    actor: Actor,
    params: {
      runId: number
      expectedAnswer: RejudgeExpectedAnswerInput
      resultIds?: number[] | null
      questionIndices?: number[] | null
      judge?: {
        modelId: string
        connectionId?: number
        rawId?: string
      }
      judgeThreshold?: number
    },
    options?: {
      emitEvent?: (event: RejudgeStreamEvent) => void
    },
  ) {
    const { runId, expectedAnswer, resultIds, questionIndices, judge, judgeThreshold } = params
    const emitEvent = options?.emitEvent

    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId, ...this.buildOwnershipWhere(actor) },
    })
    if (!run) {
      throw new Error('Battle run not found')
    }
    if (normalizeBattleMode(run.mode) === 'single_model_multi_question') {
      throw new Error('单模型多问题模式暂不支持改答案重判，请使用重试裁判')
    }

    const resolvedThreshold = typeof judgeThreshold === 'number'
      ? this.normalizeJudgeThreshold(judgeThreshold)
      : run.judgeThreshold

    const nextJudge = judge?.modelId
      ? {
        modelId: judge.modelId,
        connectionId: judge.connectionId ?? null,
        rawId: judge.rawId ?? null,
      }
      : null

    const existingExpectedAnswerImagePaths = parseImagePathsJson(run.expectedAnswerImagesJson)
    const keptImagePaths = this.imageService.resolveKeptRelativePaths(
      Array.isArray(expectedAnswer.keepImages) ? expectedAnswer.keepImages : [],
      existingExpectedAnswerImagePaths,
    )
    const newImagePaths = await this.imageService.persistImages(expectedAnswer.newImages)
    const nextExpectedAnswerImagePaths = Array.from(new Set([...keptImagePaths, ...newImagePaths]))
    const nextExpectedAnswerText = normalizeBattleText(expectedAnswer.text)
    if (!nextExpectedAnswerText && nextExpectedAnswerImagePaths.length === 0) {
      await this.imageService.deleteImages(newImagePaths)
      throw new Error('expectedAnswer 不能为空（需提供文本或图片）')
    }

    let judgeResolution: { connection: Connection; rawModelId: string }
    const promptImagePaths = parseImagePathsJson(run.promptImagesJson)
    let promptImages: BattleUploadImage[]
    let expectedAnswerImages: BattleUploadImage[]
    try {
      const resolvedJudge = await this.resolveModel(actor, {
        modelId: nextJudge?.modelId ?? run.judgeModelId,
        connectionId: nextJudge?.connectionId ?? run.judgeConnectionId ?? undefined,
        rawId: nextJudge?.rawId ?? run.judgeRawId ?? undefined,
      })
      if (!resolvedJudge) {
        throw new Error('Judge model not found')
      }
      judgeResolution = resolvedJudge

      await this.ensureVisionCapabilities({
        judge: {
          modelId: nextJudge?.modelId ?? run.judgeModelId,
          resolved: judgeResolution,
        },
        models: [],
        promptHasImages: promptImagePaths.length > 0,
        expectedAnswerHasImages: nextExpectedAnswerImagePaths.length > 0,
      })
      promptImages = await this.imageService.loadImages(promptImagePaths)
      expectedAnswerImages = await this.imageService.loadImages(nextExpectedAnswerImagePaths)

      await this.prisma.battleRun.update({
        where: { id: runId },
        data: {
          expectedAnswer: nextExpectedAnswerText,
          expectedAnswerImagesJson: safeJsonStringify(nextExpectedAnswerImagePaths, '[]'),
          ...(nextJudge ? {
            judgeModelId: nextJudge.modelId,
            judgeConnectionId: nextJudge.connectionId,
            judgeRawId: nextJudge.rawId,
          } : {}),
          judgeThreshold: resolvedThreshold,
        },
      })
    } catch (error) {
      await this.imageService.deleteImages(newImagePaths)
      throw error
    }

    const removedImagePaths = existingExpectedAnswerImagePaths.filter((item) => !nextExpectedAnswerImagePaths.includes(item))
    if (removedImagePaths.length > 0) {
      await this.imageService.deleteImages(removedImagePaths)
    }

    const scopedIds = Array.isArray(resultIds) && resultIds.length > 0
      ? Array.from(new Set(resultIds.filter((id) => Number.isFinite(id)))).slice(0, 200)
      : null
    const scopedQuestionIndices = Array.isArray(questionIndices) && questionIndices.length > 0
      ? Array.from(new Set(questionIndices.filter((id) => Number.isFinite(id) && id > 0))).slice(0, 200)
      : null

    const targets = await this.prisma.battleResult.findMany({
      where: {
        battleRunId: runId,
        error: null, // 跳过执行错误的
        ...(scopedIds ? { id: { in: scopedIds } } : {}),
        ...(scopedQuestionIndices ? { questionIndex: { in: scopedQuestionIndices } } : {}),
      },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
      take: scopedIds ? undefined : 200,
    })

    if (targets.length === 0) {
      emitEvent?.({ type: 'rejudge_complete', payload: { completed: 0, total: 0 } })
      return { total: 0, updated: 0, errors: 0 }
    }

    const total = targets.length

    const expectedAnswerContent = this.toBattleContent(nextExpectedAnswerText, nextExpectedAnswerImagePaths)
    emitEvent?.({
      type: 'rejudge_start',
      payload: { total, expectedAnswer: expectedAnswerContent },
    })

    await this.prisma.battleResult.updateMany({
      where: { id: { in: targets.map((t) => t.id) } },
      data: { judgeStatus: 'running', judgeError: null },
    })

    let completed = 0
    let updatedCount = 0
    let errorCount = 0
    const executionContext = this.buildExecutionContext(undefined, undefined)

    for (const item of targets) {
      try {
        const judged = await this.executor.judgeAnswer({
          prompt: run.prompt,
          promptImages,
          expectedAnswer: nextExpectedAnswerText,
          expectedAnswerImages,
          answer: item.output || '',
          threshold: resolvedThreshold,
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
      }

      completed += 1
      emitEvent?.({
        type: 'rejudge_progress',
        payload: { completed, total, resultId: item.id },
      })
    }

    await this.refreshRunSummary(runId)

    emitEvent?.({
      type: 'rejudge_complete',
      payload: { completed, total },
    })

    return { total, updated: updatedCount, errors: errorCount }
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
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const rawConfig = parseRunConfigPayload(run.configJson)
    const configModels = normalizeConfigModels(rawConfig)
    const configModel = normalizeConfigModel(rawConfig.model)
    const models = this.shareProjector.buildShareModels(configModels, results, configModel)
    const connectionMap = await this.buildShareConnectionMap(results, models)
    const judgeConnection = run.judgeConnectionId
      ? await this.prisma.connection.findFirst({
        where: { id: run.judgeConnectionId },
        select: { id: true, prefixId: true },
      })
      : null
    const summary = await this.resolveShareSummary(run, results)
    const liveAttempts = this.collectLiveAttempts(run.id, connectionMap)
    const payload = this.shareProjector.buildSharePayload({
      run,
      summary,
      results,
      models,
      connectionMap,
      judgeConnection,
      liveAttempts,
    })

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
      select: { id: true, mode: true, configJson: true, runsPerModel: true, passK: true, judgeThreshold: true },
    })
    if (!run) return
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const configPayload = parseRunConfigPayload(run.configJson)
    const summary = this.summaryProjector.buildSummary(
      results as BattleResultRecord[],
      run.runsPerModel,
      run.passK,
      run.judgeThreshold,
      {
        mode: normalizeBattleMode(configPayload.mode ?? run.mode),
        questionConfigs: normalizeConfigQuestions(configPayload.questions),
      },
    )
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
    const run = await this.prisma.battleRun.findFirst({
      where: { id: record.battleRunId },
    })
    if (!run) return null
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: run.id },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const rawConfig = parseRunConfigPayload(run.configJson)
    const configModels = normalizeConfigModels(rawConfig)
    const configModel = normalizeConfigModel(rawConfig.model)
    const models = this.shareProjector.buildShareModels(configModels, results, configModel)
    const connectionMap = await this.buildShareConnectionMap(results, models)
    const judgeConnection = run.judgeConnectionId
      ? await this.prisma.connection.findFirst({
        where: { id: run.judgeConnectionId },
        select: { id: true, prefixId: true },
      })
      : null
    const summary = await this.resolveShareSummary(run, results)
    const liveAttempts = this.collectLiveAttempts(run.id, connectionMap)
    const payload = this.shareProjector.buildSharePayload({
      run,
      summary,
      results,
      models,
      connectionMap,
      judgeConnection,
      liveAttempts,
    })
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

  private async executeSingleModelMultiQuestionRun(
    actor: Actor,
    input: BattleRunCreateSingleModelInput,
    options?: { emitEvent?: (event: BattleStreamEvent) => void },
  ) {
    if (!Array.isArray(input.questions) || input.questions.length === 0) {
      throw new Error('请至少添加一道题目')
    }

    const normalizedQuestions = input.questions.map((item, index) => {
      if (isBattleContentEmpty(item.prompt)) {
        throw new Error(`第 ${index + 1} 题缺少题目内容`)
      }
      if (isBattleContentEmpty(item.expectedAnswer)) {
        throw new Error(`第 ${index + 1} 题缺少期望答案`)
      }
      const runsPerQuestion = Math.min(3, Math.max(1, Math.floor(item.runsPerQuestion)))
      const passK = Math.min(3, Math.max(1, Math.floor(item.passK)))
      if (passK > runsPerQuestion) {
        throw new Error(`第 ${index + 1} 题配置错误：passK 不能大于 runsPerQuestion`)
      }
      return {
        questionIndex: index + 1,
        questionId: typeof item.questionId === 'string' && item.questionId.trim() ? item.questionId.trim() : null,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : null,
        promptText: normalizeBattleText(item.prompt.text),
        expectedAnswerText: normalizeBattleText(item.expectedAnswer.text),
        promptUploads: Array.isArray(item.prompt.images) ? item.prompt.images : [],
        expectedAnswerUploads: Array.isArray(item.expectedAnswer.images) ? item.expectedAnswer.images : [],
        runsPerQuestion,
        passK,
      }
    })

    const firstQuestion = normalizedQuestions[0]
    const title = buildRunTitle(firstQuestion.promptText || `批量题集（${normalizedQuestions.length}题）`, input.title)
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

    const persistedQuestions: BattleRunQuestionConfig[] = []
    const allQuestionImagePaths: string[] = []
    try {
      for (const question of normalizedQuestions) {
        const promptImagePaths = await this.imageService.persistImages(question.promptUploads)
        const expectedAnswerImagePaths = await this.imageService.persistImages(question.expectedAnswerUploads)
        allQuestionImagePaths.push(...promptImagePaths, ...expectedAnswerImagePaths)
        persistedQuestions.push({
          questionIndex: question.questionIndex,
          questionId: question.questionId,
          title: question.title,
          prompt: {
            text: question.promptText,
            images: promptImagePaths,
          },
          expectedAnswer: {
            text: question.expectedAnswerText,
            images: expectedAnswerImagePaths,
          },
          runsPerQuestion: question.runsPerQuestion,
          passK: question.passK,
        })
      }
    } catch (error) {
      await this.imageService.deleteImages(allQuestionImagePaths)
      throw error
    }

    const firstPersisted = persistedQuestions[0]
    const extraPrompt = typeof input.model.extraPrompt === 'string' ? input.model.extraPrompt.trim() : ''
    const normalizedSkills = normalizeConfigSkills(input.model.skills) || { enabled: [] as string[] }
    const modelConfig = {
      modelId: input.model.modelId,
      connectionId: input.model.connectionId ?? null,
      rawId: input.model.rawId ?? null,
      skills: normalizedSkills,
      ...(extraPrompt ? { extraPrompt } : {}),
      customHeaders: normalizeCustomHeadersForConfig(input.model.custom_headers),
      customBody: normalizeCustomBodyForConfig(input.model.custom_body),
      reasoningEnabled: typeof input.model.reasoningEnabled === 'boolean' ? input.model.reasoningEnabled : null,
      reasoningEffort: normalizeReasoningEffort(input.model.reasoningEffort),
      ollamaThink: typeof input.model.ollamaThink === 'boolean' ? input.model.ollamaThink : null,
    }
    const configPayload = {
      mode: 'single_model_multi_question' as const,
      judgeThreshold,
      model: modelConfig,
      questions: persistedQuestions,
    }

    let run: BattleRunRecord
    try {
      run = await this.prisma.battleRun.create({
        data: {
          ...(actor.type === 'user' ? { userId: actor.id } : {}),
          ...(actor.type === 'anonymous' ? { anonymousKey: actor.key } : {}),
          mode: 'single_model_multi_question',
          title,
          prompt: firstPersisted?.prompt.text || '',
          expectedAnswer: firstPersisted?.expectedAnswer.text || '',
          promptImagesJson: safeJsonStringify(firstPersisted?.prompt.images || [], '[]'),
          expectedAnswerImagesJson: safeJsonStringify(firstPersisted?.expectedAnswer.images || [], '[]'),
          judgeModelId: input.judge.modelId,
          judgeConnectionId: input.judge.connectionId ?? null,
          judgeRawId: input.judge.rawId ?? null,
          judgeThreshold,
          runsPerModel: 1,
          passK: 1,
          status: 'pending',
          configJson: safeJsonStringify(configPayload, '{}'),
        },
      })
    } catch (error) {
      await this.imageService.deleteImages(allQuestionImagePaths)
      throw error
    }

    const runControl = this.createRunControl(run.id, actor)
    runControl.emitEvent = (event) => {
      options?.emitEvent?.(event)
      if (runControl.eventListeners && runControl.eventListeners.size > 0) {
        for (const listener of runControl.eventListeners) {
          try {
            listener(event)
          } catch {}
        }
      }
    }
    let traceFinalStatus: TaskTraceStatus | null = null
    let traceFinalError: string | null = null

    runControl.emitEvent?.({
      type: 'run_start',
      payload: {
        id: run.id,
        mode: 'single_model_multi_question',
        title: run.title,
        prompt: this.toBattleContent(run.prompt, firstPersisted?.prompt.images || []),
        expectedAnswer: this.toBattleContent(run.expectedAnswer, firstPersisted?.expectedAnswer.images || []),
        judgeThreshold: run.judgeThreshold,
        totalQuestions: persistedQuestions.length,
      },
    })

    const startUpdate = await this.prisma.battleRun.updateMany({
      where: { id: run.id, status: 'pending' },
      data: { status: 'running' },
    })
    if (startUpdate.count === 0) {
      const summary = await this.finalizeCancelledRun(run.id, {
        runsPerModel: 1,
        passK: 1,
        judgeThreshold,
      })
      traceFinalStatus = 'cancelled'
      runControl.emitEvent?.({
        type: 'run_cancelled',
        payload: {
          id: run.id,
          summary,
        },
      })
      this.releaseRunControl(run.id)
      return { runId: run.id, summary }
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
          mode: 'single_model_multi_question',
          runId: run.id,
          title: run.title,
          questionCount: persistedQuestions.length,
          judgeThreshold,
          maxConcurrency,
          judge: {
            modelId: input.judge.modelId,
            connectionId: input.judge.connectionId ?? null,
            rawId: input.judge.rawId ?? null,
          },
          model: {
            modelId: input.model.modelId,
            connectionId: input.model.connectionId ?? null,
            rawId: input.model.rawId ?? null,
          },
        },
        maxEvents: traceDecision.config.maxEvents,
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

      const modelResolution = await this.resolveModel(actor, input.model)
      this.throwIfRunCancelled(runControl)
      if (!modelResolution) {
        await this.prisma.battleRun.updateMany({
          where: { id: run.id, status: { not: 'cancelled' } },
          data: { status: 'error', summaryJson: safeJsonStringify({ error: 'Model not found' }, '{}') },
        })
        throw new Error('Model not found')
      }

      await this.ensureVisionCapabilities({
        judge: {
          modelId: input.judge.modelId,
          resolved: judgeResolution,
        },
        models: [{
          modelId: input.model.modelId,
          resolved: modelResolution,
        }],
        promptHasImages: persistedQuestions.some((item) => item.prompt.images.length > 0),
        expectedAnswerHasImages: persistedQuestions.some((item) => item.expectedAnswer.images.length > 0),
      })

      const resolvedModel = { config: input.model, resolved: modelResolution }
      const modelKey = buildModelKey(
        input.model.modelId,
        modelResolution.connection.id,
        modelResolution.rawModelId,
      )
      const resolvedModelMap = new Map<string, { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }>()
      resolvedModelMap.set(modelKey, resolvedModel)
      const taskGroups = new Map<string, { queue: AttemptTask[]; running: boolean }>()

      runControl.runContext = {
        mode: 'single_model_multi_question',
        prompt: firstPersisted?.prompt.text || '',
        expectedAnswer: firstPersisted?.expectedAnswer.text || '',
        promptImages: [],
        expectedAnswerImages: [],
        promptImagePaths: firstPersisted?.prompt.images || [],
        expectedAnswerImagePaths: firstPersisted?.expectedAnswer.images || [],
        judgeThreshold,
        judgeModel: judgeResolution,
        systemSettings,
        singleModel: {
          model: resolvedModel,
          questions: persistedQuestions,
        },
      }
      runControl.resolvedModels = resolvedModelMap
      runControl.taskGroups = taskGroups

      for (const question of persistedQuestions) {
        const taskGroupKey = `${modelKey}#q${question.questionIndex}`
        let group = taskGroups.get(taskGroupKey)
        if (!group) {
          group = { queue: [], running: false }
          taskGroups.set(taskGroupKey, group)
        }
        for (let attempt = 1; attempt <= question.runsPerQuestion; attempt += 1) {
          const task = this.createAttemptTask({
            battleRunId: run.id,
            model: resolvedModel,
            question,
            attemptIndex: attempt,
            runControl,
          })
          group.queue.push(task)
        }
      }

      await this.runWithModelConcurrency(taskGroups, maxConcurrency, runControl)

      if (this.isRunCancelled(runControl)) {
        const summary = await this.finalizeCancelledRun(run.id, {
          runsPerModel: 1,
          passK: 1,
          judgeThreshold,
        })
        traceFinalStatus = 'cancelled'
        runControl.emitEvent?.({
          type: 'run_cancelled',
          payload: {
            id: run.id,
            summary,
          },
        })
        return { runId: run.id, summary }
      }

      const summary = await this.buildSummaryForRun(run.id, {
        runsPerModel: 1,
        passK: 1,
        judgeThreshold,
      })
      await this.prisma.battleRun.updateMany({
        where: { id: run.id, status: { not: 'cancelled' } },
        data: {
          status: 'completed',
          summaryJson: safeJsonStringify(summary, '{}'),
        },
      })

      runControl.emitEvent?.({
        type: 'run_complete',
        payload: {
          id: run.id,
          summary,
        },
      })
      traceFinalStatus = 'completed'
      return { runId: run.id, summary }
    } catch (error) {
      if (this.isRunCancelled(runControl) || (await this.isRunCancelledInDb(run.id))) {
        const summary = await this.finalizeCancelledRun(run.id, {
          runsPerModel: 1,
          passK: 1,
          judgeThreshold,
        })
        traceFinalStatus = 'cancelled'
        runControl.emitEvent?.({
          type: 'run_cancelled',
          payload: {
            id: run.id,
            summary,
          },
        })
        return { runId: run.id, summary }
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

  async executeRun(
    actor: Actor,
    input: BattleRunCreateInput,
    options?: { emitEvent?: (event: BattleStreamEvent) => void },
  ) {
    if (input.mode === 'single_model_multi_question') {
      return this.executeSingleModelMultiQuestionRun(actor, input, options)
    }

    if (isBattleContentEmpty(input.prompt)) {
      throw new Error('请输入问题或上传题目图片')
    }
    if (isBattleContentEmpty(input.expectedAnswer)) {
      throw new Error('请输入期望答案或上传答案图片')
    }

    const promptText = normalizeBattleText(input.prompt.text)
    const expectedAnswerText = normalizeBattleText(input.expectedAnswer.text)
    const promptImages = Array.isArray(input.prompt.images) ? input.prompt.images : []
    const expectedAnswerImages = Array.isArray(input.expectedAnswer.images) ? input.expectedAnswer.images : []
    const title = buildRunTitle(promptText, input.title)
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

    const promptImagePaths = await this.imageService.persistImages(promptImages)
    const expectedAnswerImagePaths = await this.imageService.persistImages(expectedAnswerImages)

    const configPayload = {
      mode: 'multi_model' as const,
      runsPerModel: input.runsPerModel,
      passK: input.passK,
      judgeThreshold,
      models: input.models.map((model) => {
        const extraPrompt = typeof model.extraPrompt === 'string' ? model.extraPrompt.trim() : ''
        const normalizedSkills = normalizeConfigSkills(model.skills) || { enabled: [] as string[] }
        return {
          modelId: model.modelId,
          connectionId: model.connectionId ?? null,
          rawId: model.rawId ?? null,
          skills: normalizedSkills,
          ...(extraPrompt ? { extraPrompt } : {}),
          customHeaders: normalizeCustomHeadersForConfig(model.custom_headers),
          customBody: normalizeCustomBodyForConfig(model.custom_body),
          reasoningEnabled: typeof model.reasoningEnabled === 'boolean' ? model.reasoningEnabled : null,
          reasoningEffort: normalizeReasoningEffort(model.reasoningEffort),
          ollamaThink: typeof model.ollamaThink === 'boolean' ? model.ollamaThink : null,
        }
      }),
    }

    let run: BattleRunRecord
    try {
      run = await this.prisma.battleRun.create({
        data: {
          ...(actor.type === 'user' ? { userId: actor.id } : {}),
          ...(actor.type === 'anonymous' ? { anonymousKey: actor.key } : {}),
          mode: 'multi_model',
          title,
          prompt: promptText,
          expectedAnswer: expectedAnswerText,
          promptImagesJson: safeJsonStringify(promptImagePaths, '[]'),
          expectedAnswerImagesJson: safeJsonStringify(expectedAnswerImagePaths, '[]'),
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
    } catch (error) {
      await this.imageService.deleteImages([...promptImagePaths, ...expectedAnswerImagePaths])
      throw error
    }
    const runControl = this.createRunControl(run.id, actor)
    runControl.emitEvent = (event) => {
      options?.emitEvent?.(event)
      if (runControl.eventListeners && runControl.eventListeners.size > 0) {
        for (const listener of runControl.eventListeners) {
          try {
            listener(event)
          } catch {}
        }
      }
    }
    let traceFinalStatus: TaskTraceStatus | null = null
    let traceFinalError: string | null = null

    runControl.emitEvent?.({
      type: 'run_start',
      payload: {
        id: run.id,
        mode: 'multi_model',
        title: run.title,
        prompt: this.toBattleContent(run.prompt, promptImagePaths),
        expectedAnswer: this.toBattleContent(run.expectedAnswer, expectedAnswerImagePaths),
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
      runControl.emitEvent?.({
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
          mode: 'multi_model',
          runId: run.id,
          title: run.title,
          promptPreview: truncateString(promptText || '', 200),
          expectedAnswerPreview: truncateString(expectedAnswerText || '', 200),
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
            skills: model.skills ? {
              enabled: model.skills.enabled,
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

      await this.ensureVisionCapabilities({
        judge: {
          modelId: input.judge.modelId,
          resolved: judgeResolution,
        },
        models: resolved.map((item) => ({
          modelId: item.config.modelId,
          resolved: item.resolved,
        })),
        promptHasImages: promptImages.length > 0,
        expectedAnswerHasImages: expectedAnswerImages.length > 0,
      })

      const taskGroups = new Map<string, { queue: AttemptTask[]; running: boolean }>()
      const resolvedModelMap = new Map<string, { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }>()

      runControl.runContext = {
        mode: 'multi_model',
        prompt: promptText,
        expectedAnswer: expectedAnswerText,
        promptImages,
        expectedAnswerImages,
        promptImagePaths,
        expectedAnswerImagePaths,
        judgeThreshold,
        judgeModel: judgeResolution,
        systemSettings,
      }
      runControl.resolvedModels = resolvedModelMap
      runControl.taskGroups = taskGroups

      const defaultQuestion: BattleRunQuestionConfig = {
        questionIndex: 1,
        questionId: null,
        title: null,
        prompt: {
          text: promptText,
          images: promptImagePaths,
        },
        expectedAnswer: {
          text: expectedAnswerText,
          images: expectedAnswerImagePaths,
        },
        runsPerQuestion: input.runsPerModel,
        passK: input.passK,
      }
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
            question: defaultQuestion,
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
        runControl.emitEvent?.({
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
          runControl.emitEvent?.({
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

      runControl.emitEvent?.({
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
        runControl.emitEvent?.({
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

  logRunTrace(runId: number, eventType: string, payload: Record<string, unknown>) {
    const control = this.activeRuns.get(runId)
    if (!control?.traceRecorder) return false
    control.traceRecorder.log(eventType, payload)
    return true
  }

  subscribeRunEvents(runId: number, listener: (event: BattleStreamEvent) => void) {
    const control = this.activeRuns.get(runId)
    if (!control) return null
    control.eventListeners.add(listener)
    return () => {
      control.eventListeners.delete(listener)
    }
  }

  private createAttemptTask(params: {
    battleRunId: number
    model: { config: BattleModelInput; resolved: { connection: Connection; rawModelId: string } }
    question: BattleRunQuestionConfig
    attemptIndex: number
    runControl: BattleRunControl
  }): AttemptTask {
    const modelKey = buildModelKey(
      params.model.config.modelId,
      params.model.resolved.connection.id,
      params.model.resolved.rawModelId,
    )
    const taskGroupKey = `${modelKey}#q${params.question.questionIndex}`
    const attemptKey = buildAttemptKey(modelKey, params.question.questionIndex, params.attemptIndex)
    const attemptEpoch = this.getAttemptEpoch(params.runControl, attemptKey)
    const context = params.runControl.runContext
    if (!context) {
      throw new Error('Battle run context missing')
    }
    return {
      taskGroupKey,
      modelKey,
      attemptKey,
      questionIndex: params.question.questionIndex,
      questionId: params.question.questionId ?? null,
      questionTitle: params.question.title ?? null,
      attemptIndex: params.attemptIndex,
      attemptEpoch,
      run: async () => {
        await this.runAttempt({
          battleRunId: params.battleRunId,
          questionIndex: params.question.questionIndex,
          questionId: params.question.questionId ?? null,
          questionTitle: params.question.title ?? null,
          prompt: params.question.prompt.text,
          expectedAnswer: params.question.expectedAnswer.text,
          promptImages: await this.imageService.loadImages(params.question.prompt.images),
          expectedAnswerImages: await this.imageService.loadImages(params.question.expectedAnswer.images),
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
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      prompt: string
      expectedAnswer: string
      promptImages: BattleUploadImage[]
      expectedAnswerImages: BattleUploadImage[]
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
      questionIndex,
      questionId,
      questionTitle,
      prompt,
      expectedAnswer,
      promptImages,
      expectedAnswerImages,
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
    const attemptKey = buildAttemptKey(modelKey, questionIndex, attemptIndex)
    const isCurrentAttempt = () => this.isAttemptEpochCurrent(runControl, attemptKey, attemptEpoch)
    if (!isCurrentAttempt()) {
      return
    }
    const traceRecorder = runControl?.traceRecorder
    const attemptTraceContext = this.buildAttemptTraceContext(runControl, attemptKey, {
      questionIndex,
      questionId,
      questionTitle,
      modelId,
      connectionId: model.resolved.connection.id,
      rawId: model.resolved.rawModelId,
    })
    if (runControl) {
      this.ensureLiveAttempt(runControl, {
        questionIndex,
        questionId,
        questionTitle,
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
        questionIndex,
        questionId,
        questionTitle,
        modelId,
        connectionId: model.resolved.connection.id,
        rawId: model.resolved.rawModelId,
        attemptIndex,
        skills: model.config.skills,
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
          questionIndex,
          questionId,
          questionTitle,
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
      skills: model.config.skills ?? undefined,
      reasoningEnabled: typeof model.config.reasoningEnabled === 'boolean' ? model.config.reasoningEnabled : undefined,
      reasoningEffort: model.config.reasoningEffort || undefined,
      ollamaThink: typeof model.config.ollamaThink === 'boolean' ? model.config.ollamaThink : undefined,
    })

    emitEvent?.({
      type: 'attempt_start',
      payload: {
        battleRunId,
        questionIndex,
        questionId,
        questionTitle,
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
    const executionContext = this.buildExecutionContext(runControl, attemptKey, {
      battleRunId,
      questionIndex,
      questionId,
      questionTitle,
      modelId,
      connectionId: model.resolved.connection.id,
      rawId: model.resolved.rawModelId,
      modelKey,
      attemptIndex,
    })

    try {
      const runResult = await this.executor.executeModel({
        prompt,
        promptImages,
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
              questionIndex,
              questionId,
              questionTitle,
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
              questionIndex,
              questionId,
              questionTitle,
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
          questionIndex,
          questionId,
          questionTitle,
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
          promptImages,
          expectedAnswer,
          expectedAnswerImages,
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
      questionIndex,
      questionId,
      questionTitle,
      modelId,
      connectionId: model.resolved.connection.id,
      rawId: model.resolved.rawModelId,
      attemptIndex,
      skills: model.config.skills,
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
        questionIndex,
        questionId,
        questionTitle,
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
        questionIndex,
        questionId,
        questionTitle,
        modelId,
        attemptIndex,
        result: this.serializeResult(record),
      },
    })
    return
  }

  private async persistResult(params: {
    battleRunId: number
    questionIndex: number
    questionId: string | null
    questionTitle: string | null
    modelId: string
    connectionId: number | null
    rawId: string | null
    attemptIndex: number
    skills?: BattleModelSkills
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
        questionIndex: params.questionIndex,
        questionId: params.questionId,
        questionTitle: params.questionTitle,
        modelId: params.modelId,
        connectionId: params.connectionId,
        rawId: params.rawId,
        attemptIndex: params.attemptIndex,
        featuresJson: safeJsonStringify(params.skills || {}, '{}'),
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
      questionIndex: record.questionIndex ?? 1,
      questionId: record.questionId ?? null,
      questionTitle: record.questionTitle ?? null,
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

  private createRunControl(runId: number, actor: Actor): BattleRunControl {
    const existing = this.activeRuns.get(runId)
    if (existing) return existing
    const control: BattleRunControl = {
      runId,
      actorUserId: actor.type === 'user' ? actor.id : null,
      actorIdentifier: actor.identifier,
      abortController: new AbortController(),
      requestControllers: new Set(),
      attemptControllers: new Map(),
      cancelledAttempts: new Set(),
      attemptEpochs: new Map(),
      liveAttempts: new Map(),
      taskGroups: new Map(),
      cancelled: false,
      traceRecorder: null,
      eventListeners: new Set(),
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
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      attemptIndex: number
    },
    reason?: string,
  ) {
    runControl.cancelledAttempts.add(params.attemptKey)
    this.ensureLiveAttempt(runControl, {
      questionIndex: params.questionIndex,
      questionId: params.questionId,
      questionTitle: params.questionTitle,
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

  private buildExecutionContext(
    runControl?: BattleRunControl,
    attemptKey?: string,
    streamMeta?: {
      battleRunId?: number | null
      questionIndex?: number
      questionId?: string | null
      questionTitle?: string | null
      modelId?: string
      connectionId?: number | null
      rawId?: string | null
      modelKey?: string
      attemptIndex?: number
    },
  ): BattleExecutionContext {
    const battleRunId = streamMeta?.battleRunId ?? runControl?.runId ?? null
    const questionIndex = streamMeta?.questionIndex ?? 1
    const questionId = streamMeta?.questionId ?? null
    const questionTitle = streamMeta?.questionTitle ?? null
    const modelId = streamMeta?.modelId
    const connectionId = streamMeta?.connectionId ?? null
    const rawId = streamMeta?.rawId ?? null
    const modelKey = streamMeta?.modelKey
    const attemptIndex = streamMeta?.attemptIndex

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
      battleRunId,
      actorUserId: runControl?.actorUserId ?? null,
      actorIdentifier: runControl?.actorIdentifier || 'battle',
      modelId,
      connectionId,
      rawId,
      modelKey,
      attemptIndex,
      sendStreamEvent: (payload) => {
        if (!payload || typeof payload !== 'object') return
        const payloadType = (payload as Record<string, unknown>).type
        if (payloadType !== 'skill_approval_request' && payloadType !== 'skill_approval_result') {
          return
        }
        runControl?.emitEvent?.({
          type: payloadType,
          payload: {
            ...payload,
            battleRunId,
            questionIndex,
            questionId,
            questionTitle,
            modelId: modelId ?? null,
            connectionId,
            rawId,
            modelKey: modelKey ?? null,
            attemptIndex: attemptIndex ?? null,
          },
        })
      },
      sendToolEvent: (payload) => {
        if (!payload || typeof payload !== 'object') return
        if (!runControl || !modelKey || !modelId || typeof attemptIndex !== 'number') return
        const normalized = normalizeBattleToolCallEvent(payload)
        if (!normalized) return

        const mergedEvents = this.upsertLiveAttemptToolEvent(runControl, {
          questionIndex,
          questionId,
          questionTitle,
          modelId,
          connectionId,
          rawId,
          attemptIndex,
          event: normalized,
        })

        runControl.emitEvent?.({
          type: 'attempt_tool_call',
          payload: {
            battleRunId,
            questionIndex,
            questionId,
            questionTitle,
            modelId,
            connectionId,
            rawId,
            modelKey,
            attemptIndex,
            event: normalized,
            timeline: mergedEvents,
          },
        })
      },
    }
  }

  private ensureLiveAttempt(
    runControl: BattleRunControl,
    params: {
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      status: LiveAttemptState['status']
      output?: string
      reasoning?: string
      durationMs?: number | null
      error?: string | null
      toolEvents?: BattleToolCallEvent[] | null
    },
  ) {
    const modelKey = buildModelKey(params.modelId, params.connectionId, params.rawId)
    const liveAttemptKey = `${params.questionIndex}#${params.attemptIndex}`
    let attempts = runControl.liveAttempts.get(modelKey)
    if (!attempts) {
      attempts = new Map()
      runControl.liveAttempts.set(modelKey, attempts)
    }
    const existing = attempts.get(liveAttemptKey)
    if (existing) {
      const next: LiveAttemptState = {
        ...existing,
        questionIndex: params.questionIndex ?? existing.questionIndex,
        questionId: params.questionId ?? existing.questionId,
        questionTitle: params.questionTitle ?? existing.questionTitle,
        status: params.status ?? existing.status,
        output: params.output ?? existing.output,
        reasoning: params.reasoning ?? existing.reasoning,
        durationMs: params.durationMs !== undefined ? params.durationMs : existing.durationMs,
        error: params.error !== undefined ? params.error : existing.error,
        toolEvents: Array.isArray(params.toolEvents) ? params.toolEvents : existing.toolEvents,
      }
      attempts.set(liveAttemptKey, next)
      return next
    }
    const record: LiveAttemptState = {
      questionIndex: params.questionIndex,
      questionId: params.questionId ?? null,
      questionTitle: params.questionTitle ?? null,
      modelId: params.modelId,
      connectionId: params.connectionId,
      rawId: params.rawId,
      attemptIndex: params.attemptIndex,
      status: params.status,
      output: params.output ?? '',
      reasoning: params.reasoning ?? '',
      durationMs: params.durationMs ?? null,
      error: params.error ?? null,
      toolEvents: Array.isArray(params.toolEvents) ? params.toolEvents : [],
    }
    attempts.set(liveAttemptKey, record)
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
    questionIndex: number,
    attemptIndex: number,
  ): LiveAttemptState | null {
    const attempts = runControl.liveAttempts.get(modelKey)
    if (!attempts) return null
    return attempts.get(`${questionIndex}#${attemptIndex}`) || null
  }

  private appendLiveAttemptDelta(
    runControl: BattleRunControl,
    params: {
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      content?: string
      reasoning?: string
    },
  ) {
    const record = this.ensureLiveAttempt(runControl, {
      questionIndex: params.questionIndex,
      questionId: params.questionId,
      questionTitle: params.questionTitle,
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

  private upsertLiveAttemptToolEvent(
    runControl: BattleRunControl,
    params: {
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      modelId: string
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      event: BattleToolCallEvent
    },
  ) {
    const record = this.ensureLiveAttempt(runControl, {
      questionIndex: params.questionIndex,
      questionId: params.questionId,
      questionTitle: params.questionTitle,
      modelId: params.modelId,
      connectionId: params.connectionId,
      rawId: params.rawId,
      attemptIndex: params.attemptIndex,
      status: 'running',
    })
    const next = [...record.toolEvents]
    const key = buildToolEventKey(params.event)
    const index = next.findIndex((item) => buildToolEventKey(item) === key)
    if (index >= 0) {
      next[index] = mergeToolEvent(next[index], params.event)
    } else {
      next.push(params.event)
    }
    next.sort(compareToolEvents)
    record.toolEvents = next
    return next
  }

  private collectLiveAttempts(runId: number, connectionMap: Map<number, LabelConnection>) {
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
      if (keyA === keyB) {
        if (a.questionIndex !== b.questionIndex) return a.questionIndex - b.questionIndex
        return a.attemptIndex - b.attemptIndex
      }
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
    const run = await this.prisma.battleRun.findFirst({
      where: { id: runId },
      select: { mode: true, configJson: true },
    })
    const results = await this.prisma.battleResult.findMany({
      where: { battleRunId: runId },
      orderBy: [{ questionIndex: 'asc' }, { modelId: 'asc' }, { attemptIndex: 'asc' }],
    })
    const configPayload = parseRunConfigPayload(run?.configJson)
    return this.summaryProjector.buildSummary(
      results as BattleResultRecord[],
      config.runsPerModel,
      config.passK,
      config.judgeThreshold,
      {
        mode: normalizeBattleMode(configPayload.mode ?? run?.mode),
        questionConfigs: normalizeConfigQuestions(configPayload.questions),
      },
    )
  }

  private async buildShareConnectionMap(
    results: BattleResultRecord[],
    models: BattleRunConfigModel[],
  ): Promise<Map<number, LabelConnection>> {
    const connectionIds = Array.from(
      new Set(
        [
          ...results.map((item) => item.connectionId),
          ...models.map((item) => item.connectionId),
        ].filter((value): value is number => typeof value === 'number'),
      ),
    )
    if (connectionIds.length === 0) {
      return new Map()
    }
    const connections = await this.prisma.connection.findMany({
      where: { id: { in: connectionIds } },
      select: { id: true, prefixId: true },
    })
    return new Map(connections.map((connection) => [connection.id, connection]))
  }

  private async resolveShareSummary(run: BattleRunRecord, results: BattleResultRecord[]) {
    const configPayload = parseRunConfigPayload(run.configJson)
    const mode = normalizeBattleMode(configPayload.mode ?? run.mode)
    const questionConfigs = normalizeConfigQuestions(configPayload.questions)
    const rawSummary = safeParseJson<Record<string, any>>(run.summaryJson, {})
    let summary = this.summaryProjector.normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })
    const shouldRebuildSummary =
      results.length > 0 && (
        mode === 'single_model_multi_question'
          ? ((summary.questionStats?.length || 0) === 0 || !summary.totalQuestions)
          : (summary.modelStats.length === 0 || summary.totalModels === 0)
      )
    if (shouldRebuildSummary) {
      summary = this.summaryProjector.buildSummary(
        results as BattleResultRecord[],
        run.runsPerModel,
        run.passK,
        run.judgeThreshold,
        {
          mode,
          questionConfigs,
        },
      )
      if (run.status === 'completed' || run.status === 'cancelled') {
        await this.prisma.battleRun.update({
          where: { id: run.id },
          data: { summaryJson: safeJsonStringify(summary, '{}') },
        })
      }
    }
    return summary
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

  private toBattleContent(text: string, imagePaths: string[]): BattleContent {
    return {
      text: text || '',
      images: this.imageService.resolveImageUrls(imagePaths, { baseUrl: '' }),
    }
  }

  private collectUniqueBattleImagePaths(
    runs: Array<{ promptImagesJson: string | null; expectedAnswerImagesJson: string | null }>,
  ) {
    const set = new Set<string>()
    for (const run of runs) {
      for (const imagePath of parseImagePathsJson(run.promptImagesJson)) {
        set.add(imagePath)
      }
      for (const imagePath of parseImagePathsJson(run.expectedAnswerImagesJson)) {
        set.add(imagePath)
      }
    }
    return Array.from(set)
  }

  private scheduleAsyncVacuum() {
    if (this.vacuumInFlight) {
      return true
    }

    this.vacuumInFlight = new Promise((resolve) => {
      const execute = async () => {
        try {
          await this.runVacuum()
        } finally {
          this.vacuumInFlight = null
          resolve()
        }
      }
      setTimeout(() => {
        void execute()
      }, 0)
    })

    return true
  }

  private async runVacuum() {
    try {
      await this.prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch (error) {
      log.debug('battle wal checkpoint skipped', {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    try {
      await this.prisma.$executeRawUnsafe('VACUUM')
      log.info('battle sqlite vacuum completed')
    } catch (error) {
      log.warn('battle sqlite vacuum failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async ensureVisionCapabilities(params: {
    judge: { modelId: string; resolved: { connection: Connection; rawModelId: string } }
    models: Array<{ modelId: string; resolved: { connection: Connection; rawModelId: string } }>
    promptHasImages: boolean
    expectedAnswerHasImages: boolean
  }) {
    const checks: Array<{
      label: string
      connectionId: number
      rawModelId: string
    }> = []

    if (params.promptHasImages) {
      for (const model of params.models) {
        checks.push({
          label: composeModelLabel(model.resolved.connection, model.resolved.rawModelId, model.modelId) || model.modelId,
          connectionId: model.resolved.connection.id,
          rawModelId: model.resolved.rawModelId,
        })
      }
      checks.push({
        label: `裁判 ${composeModelLabel(params.judge.resolved.connection, params.judge.resolved.rawModelId, params.judge.modelId) || params.judge.modelId}`,
        connectionId: params.judge.resolved.connection.id,
        rawModelId: params.judge.resolved.rawModelId,
      })
    } else if (params.expectedAnswerHasImages) {
      checks.push({
        label: `裁判 ${composeModelLabel(params.judge.resolved.connection, params.judge.resolved.rawModelId, params.judge.modelId) || params.judge.modelId}`,
        connectionId: params.judge.resolved.connection.id,
        rawModelId: params.judge.resolved.rawModelId,
      })
    }

    if (checks.length === 0) return

    const deduped = new Map<string, { label: string; connectionId: number; rawModelId: string }>()
    for (const item of checks) {
      deduped.set(`${item.connectionId}:${item.rawModelId}`, item)
    }

    const unsupported: string[] = []
    for (const item of deduped.values()) {
      const supported = await this.isVisionEnabledModel(item.connectionId, item.rawModelId)
      if (!supported) {
        unsupported.push(item.label)
      }
    }

    if (unsupported.length > 0) {
      throw new Error(`以下模型不支持图片输入：${unsupported.join('、')}`)
    }
  }

  private async isVisionEnabledModel(connectionId: number, rawModelId: string) {
    const row = await this.prisma.modelCatalog.findFirst({
      where: {
        connectionId,
        rawId: rawModelId,
      },
      select: { capabilitiesJson: true },
    })
    if (!row?.capabilitiesJson) {
      return false
    }
    const envelope = parseCapabilityEnvelope(row.capabilitiesJson)
    return envelope?.flags?.vision === true
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
          enqueue: (taskGroupKey, task) => {
            if (settled || this.isRunCancelled(runControl)) return false
            let group = groupsMap.get(taskGroupKey)
            if (!group) {
              group = { queue: [], running: false }
              groupsMap.set(taskGroupKey, group)
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
    const summary = this.summaryProjector.normalizeSummary(rawSummary, {
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      judgeThreshold: run.judgeThreshold,
    })

    const promptImagePaths = parseImagePathsJson(run.promptImagesJson)
    const expectedAnswerImagePaths = parseImagePathsJson(run.expectedAnswerImagesJson)

    return {
      id: run.id,
      mode: normalizeBattleMode(run.mode),
      title: run.title,
      prompt: this.toBattleContent(run.prompt, promptImagePaths),
      expectedAnswer: this.toBattleContent(run.expectedAnswer, expectedAnswerImagePaths),
      judgeModelId: run.judgeModelId,
      judgeConnectionId: run.judgeConnectionId,
      judgeRawId: run.judgeRawId,
      judgeThreshold: run.judgeThreshold,
      runsPerModel: run.runsPerModel,
      passK: run.passK,
      status: normalizeRunStatus(run.status),
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
    params: {
      modelId?: string | null
      connectionId?: number | null
      rawId?: string | null
      questionIndex?: number | null
      attemptIndex: number
    },
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
    const mode = normalizeBattleMode(runControl.runContext?.mode)
    const questionConfigs = runControl.runContext?.singleModel?.questions || []
    const requestedQuestionIndex = typeof params.questionIndex === 'number' && params.questionIndex > 0
      ? Math.floor(params.questionIndex)
      : 1
    const question = mode === 'single_model_multi_question'
      ? questionConfigs.find((item) => item.questionIndex === requestedQuestionIndex)
      : {
        questionIndex: 1,
        questionId: null,
        title: null,
        prompt: {
          text: runControl.runContext?.prompt || '',
          images: runControl.runContext?.promptImagePaths || [],
        },
        expectedAnswer: {
          text: runControl.runContext?.expectedAnswer || '',
          images: runControl.runContext?.expectedAnswerImagePaths || [],
        },
        runsPerQuestion: 1,
        passK: 1,
      }
    if (!question) return null
    const taskGroupKey = `${modelKey}#q${question.questionIndex}`

    return {
      mode,
      questionConfigs,
      question,
      taskGroupKey,
      questionIndex: question.questionIndex,
      questionId: question.questionId ?? null,
      questionTitle: question.title ?? null,
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
