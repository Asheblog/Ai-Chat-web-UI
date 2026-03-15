import type { BattleStreamEvent } from '@aichat/shared/battle-contract'
import type {
  ExecutionRunMetricsPayload,
  ExecutionSseEvent,
  ExecutionSourceType,
  ExecutionStatus,
} from '@aichat/shared/execution-contract'

export interface BattleExecutionEventBridgeOptions {
  runKey: string
  sourceType: ExecutionSourceType
  sourceId: string
  clock?: () => number
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const asInteger = (value: unknown, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed)
    }
  }
  return fallback
}

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null

const resolveStepId = (payload: UnknownRecord | null) => {
  const modelSegment =
    asNonEmptyString(payload?.modelKey) ||
    asNonEmptyString(payload?.modelId) ||
    asNonEmptyString(payload?.rawId) ||
    'model'
  const questionIndex = asInteger(payload?.questionIndex, 1)
  const attemptIndex = asInteger(payload?.attemptIndex, 1)
  return `${modelSegment}:q${questionIndex}:a${attemptIndex}`
}

export const createBattleExecutionEventBridge = (
  options: BattleExecutionEventBridgeOptions,
) => {
  let eventSeq = 0
  const clock = options.clock ?? Date.now

  const nextEvent = <TPayload extends UnknownRecord>(
    type: ExecutionSseEvent<TPayload>['type'],
    status: ExecutionStatus,
    payload: TPayload,
    meta?: {
      stepId?: string
      agentRole?: string
    },
  ): ExecutionSseEvent<TPayload> => ({
    type,
    runId: options.runKey,
    eventId: `${options.runKey}:evt:${++eventSeq}`,
    ts: clock(),
    status,
    ...(meta?.stepId ? { stepId: meta.stepId } : {}),
    ...(meta?.agentRole ? { agentRole: meta.agentRole } : {}),
    payload,
  })

  const consume = (legacyEvent: BattleStreamEvent): ExecutionSseEvent[] => {
    const payload = asRecord(legacyEvent?.payload)

    switch (legacyEvent?.type) {
      case 'run_start': {
        const payloadRunId =
          typeof payload?.id === 'number' && Number.isFinite(payload.id)
            ? String(payload.id)
            : asNonEmptyString(payload?.id)
        const runStart = nextEvent('run_start', 'running', {
          sourceType: options.sourceType,
          sourceId: payloadRunId ?? options.sourceId,
          mode: asNonEmptyString(payload?.mode) ?? null,
          title: asNonEmptyString(payload?.title) ?? null,
          input: payload,
        })
        const planReady = nextEvent('plan_ready', 'running', {
          steps: [],
        })
        return [runStart, planReady]
      }
      case 'attempt_start': {
        const stepId = resolveStepId(payload)
        return [
          nextEvent(
            'step_start',
            'running',
            {
              title: 'battle_attempt',
              metadata: payload ?? {},
            },
            {
              stepId,
              agentRole:
                asNonEmptyString(payload?.modelId) ??
                asNonEmptyString(payload?.rawId) ??
                undefined,
            },
          ),
        ]
      }
      case 'attempt_delta': {
        const stepId = resolveStepId(payload)
        const deltas: ExecutionSseEvent[] = []
        const contentDelta = asNonEmptyString(payload?.delta)
        const reasoningDelta = asNonEmptyString(payload?.reasoning)
        if (contentDelta) {
          deltas.push(
            nextEvent(
              'step_delta',
              'running',
              {
                channel: 'content',
                delta: contentDelta,
              },
              {
                stepId,
                agentRole:
                  asNonEmptyString(payload?.modelId) ??
                  asNonEmptyString(payload?.rawId) ??
                  undefined,
              },
            ),
          )
        }
        if (reasoningDelta) {
          deltas.push(
            nextEvent(
              'step_delta',
              'running',
              {
                channel: 'reasoning',
                delta: reasoningDelta,
              },
              {
                stepId,
                agentRole:
                  asNonEmptyString(payload?.modelId) ??
                  asNonEmptyString(payload?.rawId) ??
                  undefined,
              },
            ),
          )
        }
        return deltas
      }
      case 'attempt_tool_call': {
        const stepId = resolveStepId(payload)
        return [
          nextEvent(
            'step_artifact',
            'running',
            {
              kind: 'tool_call',
              data: {
                event: asRecord(payload?.event) ?? payload?.event,
                timeline: Array.isArray(payload?.timeline)
                  ? payload?.timeline
                  : undefined,
              },
            },
            {
              stepId,
              agentRole:
                asNonEmptyString(payload?.modelId) ??
                asNonEmptyString(payload?.rawId) ??
                undefined,
            },
          ),
        ]
      }
      case 'attempt_complete': {
        const result = asRecord(payload?.result)
        const stepId =
          resolveStepId(
            asRecord({
              modelKey: payload?.modelKey,
              modelId: result?.modelId ?? payload?.modelId,
              rawId: result?.rawId ?? payload?.rawId,
              questionIndex: result?.questionIndex ?? payload?.questionIndex,
              attemptIndex: result?.attemptIndex ?? payload?.attemptIndex,
            }),
          )
        const hasError = Boolean(asNonEmptyString(result?.error) ?? asNonEmptyString(payload?.error))
        return [
          nextEvent(
            'step_complete',
            hasError ? 'error' : 'completed',
            {
              result: result ?? payload ?? {},
              error: asNonEmptyString(result?.error) ?? asNonEmptyString(payload?.error),
              durationMs:
                typeof result?.durationMs === 'number' && Number.isFinite(result.durationMs)
                  ? result.durationMs
                  : null,
            },
            {
              stepId,
              agentRole:
                asNonEmptyString(result?.modelId) ??
                asNonEmptyString(payload?.modelId) ??
                asNonEmptyString(result?.rawId) ??
                asNonEmptyString(payload?.rawId) ??
                undefined,
            },
          ),
        ]
      }
      case 'run_complete': {
        const summary = asRecord(payload?.summary) ?? {}
        const metricsPayload: ExecutionRunMetricsPayload = {
          retries: undefined,
          failedSteps:
            typeof summary.totalModels === 'number' && typeof summary.passModelCount === 'number'
              ? Math.max(0, summary.totalModels - summary.passModelCount)
              : undefined,
          completedSteps:
            typeof summary.totalModels === 'number' ? summary.totalModels : undefined,
          usage: summary,
        }
        return [
          nextEvent('run_metrics', 'running', metricsPayload as UnknownRecord),
          nextEvent('run_complete', 'completed', {
            summary,
            output: summary,
          }),
        ]
      }
      case 'run_cancelled': {
        return [
          nextEvent('run_error', 'cancelled', {
            message: 'Run cancelled',
            details: payload ?? {},
          }),
        ]
      }
      case 'error': {
        return [
          nextEvent('run_error', 'error', {
            message: asNonEmptyString(legacyEvent.error) ?? 'Battle failed',
            details: payload ?? {},
          }),
        ]
      }
      case 'skill_approval_request':
      case 'skill_approval_result': {
        const stepId = resolveStepId(payload)
        return [
          nextEvent(
            'step_artifact',
            'running',
            {
              kind: 'result',
              name: legacyEvent.type,
              data: payload ?? {},
            },
            { stepId },
          ),
        ]
      }
      case 'complete': {
        return [nextEvent('complete', 'completed', {})]
      }
      default:
        return []
    }
  }

  return {
    consume,
  }
}
