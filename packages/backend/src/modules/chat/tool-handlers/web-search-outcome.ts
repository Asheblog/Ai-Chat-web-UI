/**
 * 检索结果的可机读结论（retrievalOutcome）与机读摘要（evidenceSummary）。
 *
 * #119 的核心问题：全失败、成功零条、取消、子任务超时在旧实现里都表现为空结果，
 * 父结果无法区分，最终答复只能靠正文措辞猜测。这里把判据集中到一处：
 * - status/reason 表达结论；
 * - engines 表达每个引擎的最终状态（含退避跳过）；
 * - cancellation 只记录请求级取消，批次超时不冒充取消；
 * - evidenceSummary 只做计数与未核实来源收口，不解析正文。
 */

import type { WebSearchTaskFailureKind, WebSearchTaskResult } from '../../../utils/web-search'

export type RetrievalStatus = 'success' | 'partial' | 'empty' | 'failed' | 'timeout' | 'cancelled'

export type RetrievalReason =
  | 'results'
  | 'partial_results'
  | 'no_results'
  | 'no_results_in_restricted_sources'
  | 'all_sources_failed'
  | 'all_sources_timed_out'
  | 'request_cancelled'
  | 'no_active_engine'
  | 'invalid_request'
  | 'domains_outside_whitelist'
  | 'all_sources_cooling_down'
  | 'no_content'
  | 'read_failed'

export type RetrievalEngineState =
  | 'ok'
  | 'error'
  | 'timed_out'
  | 'cancelled'
  | 'skipped_backoff'

export interface RetrievalEngineReport {
  engine: string
  state: RetrievalEngineState
  failureKind?: WebSearchTaskFailureKind
  errorCode?: string
  httpStatus?: number
  retryAfterMs?: number
}

export type AutoReadState = 'off' | 'ok' | 'partial' | 'deadline' | 'cancelled'

export interface RetrievalAutoReadReport {
  state: AutoReadState
  requested: number
  candidatesExamined: number
  bodies: number
  summaryOnly: number
  failed: number
  skipped: number
}

export interface RetrievalEvidenceCounts {
  article: number
  structured: number
  summary: number
  none: number
}

export interface RetrievalRestriction {
  restricted: boolean
  requested: string[]
  effective: string[]
}

export interface RetrievalTimeRangeReport {
  start: string | null
  end: string | null
  /** 命中里可解析且落在窗口内的条数。 */
  verified: number
  /** 没有可解析日期、保留但未核实的条数。 */
  undated: number
}

export interface RetrievalEscalationReport {
  triggered: boolean
  engine?: string
  reason: string | null
}

export interface RetrievalOutcome {
  status: RetrievalStatus
  reason: RetrievalReason
  retryable: boolean
  retryAfterMs: number | null
  /** 仍有结果但存在失败/退避/批次降级。 */
  degraded: boolean
  cancellation: { requested: boolean; source: 'request' | null }
  search: {
    attempted: number
    succeeded: number
    failed: number
    empty: number
    timedOut: number
    cancelled: number
    skippedBackoff: number
    failureKinds: Partial<Record<WebSearchTaskFailureKind, number>>
    exhaustion: 'none' | 'all_failed' | 'all_cooling_down'
  }
  autoRead: RetrievalAutoReadReport
  evidence: RetrievalEvidenceCounts
  engines: RetrievalEngineReport[]
  timeRange: RetrievalTimeRangeReport | null
  restriction: RetrievalRestriction
  escalation: RetrievalEscalationReport
}

export type ReadFailureReason =
  | 'timeout'
  | 'blocked'
  | 'paywall'
  | 'too_large'
  | 'unsupported'
  | 'http_4xx'
  | 'http_5xx'
  | 'network'
  | 'empty'
  | 'cancelled'
  | 'unknown'

/** url-reader 的具体错误码 → 固定枚举；调用方按枚举分组统计未核实来源。 */
export const mapReadFailureReason = (errorCode?: string | null): ReadFailureReason => {
  switch ((errorCode || '').toUpperCase()) {
    case 'TIMEOUT':
      return 'timeout'
    case 'CANCELLED':
      return 'cancelled'
    case 'HTTP_403':
    case 'JS_CHALLENGE':
    case 'ROBOTS_DENIED':
      return 'blocked'
    case 'HTTP_401':
    case 'HTTP_404':
    case 'HTTP_429':
    case 'HTTP_4XX':
      return 'http_4xx'
    case 'HTTP_5XX':
    case 'HTTP_ERROR':
      return 'http_5xx'
    case 'BODY_TOO_LARGE':
      return 'too_large'
    case 'UNSUPPORTED_CONTENT_TYPE':
    case 'BROWSER_UNAVAILABLE':
    case 'BROWSER_BUSY':
    case 'INVALID_URL':
    case 'DISALLOWED_URL':
      return 'unsupported'
    case 'EMPTY_CONTENT':
    case 'PARSE_EMPTY':
      return 'empty'
    case 'FETCH_FAILED':
      return 'network'
    default:
      return 'unknown'
  }
}

export interface EvidenceSummaryFailure {
  url: string
  reason: ReadFailureReason
}

export interface EvidenceSummary {
  /** 内容来源：origin 为原站读取，provider 为复用提供方正文，search 为搜索结果本身。 */
  source: 'search' | 'origin' | 'provider'
  /** 执行过的查询（去重，顺序即计划顺序）。 */
  queries: string[]
  /** 合并后返回的命中数。 */
  results: number
  /** 取得有效正文（article / structured）的条数。 */
  read: number
  /** 读取过但没有得到正文的条数。 */
  readFailed: number
  truncated: number
  engines: string[]
  failures: EvidenceSummaryFailure[]
  restricted: boolean
  restrictedTo: string[]
  timeRange: { verified: number; undated: number } | null
}

const RETRYABLE_KINDS: ReadonlySet<WebSearchTaskFailureKind> = new Set([
  'upstream_error',
  'rate_limited',
  'network',
  'timeout',
])

export interface SkippedEngineReport {
  engine: string
  retryAfterMs: number
}

export interface BuildRetrievalOutcomeInput {
  taskResults: WebSearchTaskResult[]
  attempted: number
  skippedEngines: SkippedEngineReport[]
  autoRead: RetrievalAutoReadReport
  evidence: RetrievalEvidenceCounts
  cancelled: boolean
  totalHits: number
  restriction: RetrievalRestriction
  timeRange?: RetrievalTimeRangeReport | null
  escalation?: RetrievalEscalationReport
  /** 调用点掌握更准确的「可用引擎耗尽」判据时覆盖推导值。 */
  exhaustedOverride?: 'none' | 'all_failed' | 'all_cooling_down'
  /** 调用点已经判定「没有可用引擎」（例如未配置 Key）时的固定结论。 */
  override?: { status: RetrievalStatus; reason: RetrievalReason }
}

const engineStateOf = (result: WebSearchTaskResult): RetrievalEngineState => {
  if (result.status === 'success') return 'ok'
  if (result.failureKind === 'timeout') return 'timed_out'
  if (result.failureKind === 'cancelled') return 'cancelled'
  return 'error'
}

const buildEngineReports = (input: BuildRetrievalOutcomeInput): RetrievalEngineReport[] => {
  const byEngine = new Map<string, RetrievalEngineReport>()
  for (const result of input.taskResults) {
    const engine = result.task.engine
    const next: RetrievalEngineReport = {
      engine,
      state: engineStateOf(result),
      ...(result.failureKind ? { failureKind: result.failureKind } : {}),
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(typeof result.httpStatus === 'number' ? { httpStatus: result.httpStatus } : {}),
      ...(typeof result.retryAfterMs === 'number' ? { retryAfterMs: result.retryAfterMs } : {}),
    }
    const existing = byEngine.get(engine)
    // 同一引擎多任务：只要有一条成功就按 ok 报告，不把成功的引擎标成失败
    if (!existing || (existing.state !== 'ok' && next.state === 'ok')) {
      byEngine.set(engine, next)
    }
  }
  for (const skipped of input.skippedEngines) {
    if (byEngine.has(skipped.engine)) continue
    byEngine.set(skipped.engine, {
      engine: skipped.engine,
      state: 'skipped_backoff',
      retryAfterMs: skipped.retryAfterMs,
    })
  }
  return Array.from(byEngine.values())
}

export const buildRetrievalOutcome = (input: BuildRetrievalOutcomeInput): RetrievalOutcome => {
  const succeeded = input.taskResults.filter((result) => result.status === 'success').length
  const failedResults = input.taskResults.filter((result) => result.status !== 'success')
  const empty = input.taskResults.filter(
    (result) => result.status === 'success' && result.hits.length === 0,
  ).length
  const timedOut = failedResults.filter((result) => result.failureKind === 'timeout').length
  const cancelledTasks = failedResults.filter((result) => result.failureKind === 'cancelled').length
  const failureKinds: Partial<Record<WebSearchTaskFailureKind, number>> = {}
  for (const result of failedResults) {
    if (!result.failureKind) continue
    failureKinds[result.failureKind] = (failureKinds[result.failureKind] || 0) + 1
  }

  const retryCandidates: number[] = []
  for (const result of failedResults) {
    if (typeof result.retryAfterMs === 'number') retryCandidates.push(result.retryAfterMs)
  }
  for (const skipped of input.skippedEngines) {
    if (Number.isFinite(skipped.retryAfterMs)) retryCandidates.push(skipped.retryAfterMs)
  }
  const retryable =
    failedResults.some((result) => Boolean(result.failureKind && RETRYABLE_KINDS.has(result.failureKind))) ||
    input.skippedEngines.length > 0

  const exhaustion: RetrievalOutcome['search']['exhaustion'] = input.exhaustedOverride ??
    (input.attempted === 0 && input.skippedEngines.length > 0
      ? 'all_cooling_down'
      : input.attempted > 0 && succeeded === 0
        ? 'all_failed'
        : 'none')

  const base = {
    retryable,
    retryAfterMs: retryCandidates.length > 0 ? Math.max(...retryCandidates) : null,
    cancellation: {
      requested: input.cancelled,
      source: input.cancelled ? ('request' as const) : null,
    },
    search: {
      attempted: input.attempted,
      succeeded,
      failed: failedResults.length,
      empty,
      timedOut,
      cancelled: cancelledTasks,
      skippedBackoff: input.skippedEngines.length,
      failureKinds,
      exhaustion,
    },
    autoRead: input.autoRead,
    evidence: input.evidence,
    engines: buildEngineReports(input),
    timeRange: input.timeRange ?? null,
    restriction: input.restriction,
    escalation: input.escalation ?? { triggered: false, reason: null },
  }

  const degraded =
    failedResults.length > 0 ||
    input.skippedEngines.length > 0 ||
    input.autoRead.state === 'partial' ||
    input.autoRead.state === 'deadline'

  if (input.override) {
    return { ...base, status: input.override.status, reason: input.override.reason, degraded }
  }

  if (input.cancelled) {
    return { ...base, status: 'cancelled', reason: 'request_cancelled', retryable: false, degraded }
  }

  if (succeeded === 0) {
    if (input.attempted === 0) {
      return { ...base, status: 'failed', reason: 'all_sources_cooling_down', degraded: true }
    }
    if (failedResults.length > 0 && timedOut === failedResults.length) {
      return { ...base, status: 'timeout', reason: 'all_sources_timed_out', degraded }
    }
    return { ...base, status: 'failed', reason: 'all_sources_failed', degraded }
  }

  if (input.totalHits === 0) {
    return {
      ...base,
      status: 'empty',
      reason: input.restriction.restricted ? 'no_results_in_restricted_sources' : 'no_results',
      degraded,
    }
  }

  if (failedResults.length > 0 || input.skippedEngines.length > 0) {
    return { ...base, status: 'partial', reason: 'partial_results', degraded: true }
  }

  return { ...base, status: 'success', reason: 'results', degraded }
}

const EMPTY_AUTO_READ: RetrievalAutoReadReport = {
  state: 'off',
  requested: 0,
  candidatesExamined: 0,
  bodies: 0,
  summaryOnly: 0,
  failed: 0,
  skipped: 0,
}

const EMPTY_EVIDENCE: RetrievalEvidenceCounts = { article: 0, structured: 0, summary: 0, none: 0 }

const EMPTY_RESTRICTION: RetrievalRestriction = { restricted: false, requested: [], effective: [] }

/** 在没有执行任何引擎调用时给出确定的终端结论（参数错误、无可用引擎、取消、全冷却）。 */
export const buildTerminalOutcome = (input: {
  status: RetrievalStatus
  reason: RetrievalReason
  restriction?: RetrievalRestriction
  cancelled?: boolean
  skippedEngines?: SkippedEngineReport[]
  exhaustedOverride?: 'none' | 'all_failed' | 'all_cooling_down'
  retryable?: boolean
  retryAfterMs?: number | null
}): RetrievalOutcome => {
  const outcome = buildRetrievalOutcome({
    taskResults: [],
    attempted: 0,
    skippedEngines: input.skippedEngines ?? [],
    autoRead: { ...EMPTY_AUTO_READ, state: input.cancelled ? 'cancelled' : 'off' },
    evidence: { ...EMPTY_EVIDENCE },
    cancelled: Boolean(input.cancelled),
    totalHits: 0,
    restriction: input.restriction ?? { ...EMPTY_RESTRICTION },
    timeRange: null,
    exhaustedOverride: input.exhaustedOverride,
    override: { status: input.status, reason: input.reason },
  })
  return {
    ...outcome,
    ...(typeof input.retryable === 'boolean' ? { retryable: input.retryable } : {}),
    ...(input.retryAfterMs !== undefined ? { retryAfterMs: input.retryAfterMs } : {}),
  }
}

export interface BuildEvidenceSummaryInput {
  source: 'search' | 'origin' | 'provider'
  queries: string[]
  hits: number
  autoRead: RetrievalAutoReadReport
  evidence: RetrievalEvidenceCounts
  engines: string[]
  failures: EvidenceSummaryFailure[]
  truncated: number
  restriction: RetrievalRestriction
  timeRange?: RetrievalTimeRangeReport | null
}

export const buildEvidenceSummary = (input: BuildEvidenceSummaryInput): EvidenceSummary => ({
  source: input.source,
  queries: input.queries,
  results: input.hits,
  read: input.evidence.article + input.evidence.structured,
  readFailed: input.failures.length,
  truncated: input.truncated,
  engines: input.engines,
  failures: input.failures,
  restricted: input.restriction.restricted,
  restrictedTo: input.restriction.effective,
  timeRange: input.timeRange ? { verified: input.timeRange.verified, undated: input.timeRange.undated } : null,
})
