import type { ExecutionSseEvent, ExecutionStatus } from '@aichat/shared/execution-contract'

export interface ChatExecutionEventBridgeOptions {
  runKey: string
  sessionId: number
  sourceId?: string
  clock?: () => number
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export const createChatExecutionEventBridge = (options: ChatExecutionEventBridgeOptions) => {
  let eventSeq = 0
  const clock = options.clock ?? Date.now
  let runStarted = false
  let planReady = false
  let stepStarted = false
  let stepId = 'assistant-main'
  let agentRole: string | undefined = 'assistant'

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

  const ensureBootEvents = (meta?: { assistantMessageId?: unknown; assistantClientMessageId?: unknown }) => {
    const events: ExecutionSseEvent[] = []
    if (!runStarted) {
      runStarted = true
      events.push(
        nextEvent('run_start', 'running', {
          sourceType: 'chat',
          sourceId: options.sourceId ?? String(options.sessionId),
          mode: 'chat',
          title: null,
          input: {
            sessionId: options.sessionId,
          },
        }),
      )
    }
    if (!planReady) {
      planReady = true
      events.push(
        nextEvent('plan_ready', 'running', {
          steps: [
            {
              stepId,
              title: 'assistant_response',
              agentRole: 'assistant',
              dependencies: [],
              maxRetries: 0,
            },
          ],
        }),
      )
    }
    const nextStepId =
      asString(meta?.assistantClientMessageId) ||
      (asNumber(meta?.assistantMessageId) != null
        ? `assistant:${String(meta?.assistantMessageId)}`
        : null)
    if (nextStepId) {
      stepId = nextStepId
    }
    if (!stepStarted) {
      stepStarted = true
      events.push(
        nextEvent(
          'step_start',
          'running',
          {
            title: 'assistant_response',
            metadata: {
              sessionId: options.sessionId,
            },
          },
          { stepId, agentRole },
        ),
      )
    }
    return events
  }

  const consume = (legacyEvent: UnknownRecord): ExecutionSseEvent[] => {
    const type = asString(legacyEvent?.type)
    const events: ExecutionSseEvent[] = []

    if (!type) {
      return events
    }

    if (type === 'keepalive') {
      return events
    }

    if (type === 'start') {
      events.push(
        ...ensureBootEvents({
          assistantMessageId: legacyEvent.assistantMessageId,
          assistantClientMessageId: legacyEvent.assistantClientMessageId,
        }),
      )
      return events
    }

    if (type === 'content') {
      events.push(...ensureBootEvents())
      const delta = asString(legacyEvent.content)
      if (!delta) return events
      events.push(
        nextEvent(
          'step_delta',
          'running',
          {
            channel: 'content',
            delta,
          },
          { stepId, agentRole },
        ),
      )
      return events
    }

    if (type === 'reasoning') {
      events.push(...ensureBootEvents())
      const delta = asString(legacyEvent.content)
      if (delta) {
        events.push(
          nextEvent(
            'step_delta',
            'running',
            {
              channel: 'reasoning',
              delta,
            },
            { stepId, agentRole },
          ),
        )
      }
      if (legacyEvent.done === true) {
        events.push(
          nextEvent(
            'step_artifact',
            'running',
            {
              kind: 'result',
              name: 'reasoning_done',
              data: {
                duration: asNumber(legacyEvent.duration),
              },
            },
            { stepId, agentRole },
          ),
        )
      }
      return events
    }

    if (type === 'tool_call') {
      events.push(...ensureBootEvents())
      events.push(
        nextEvent(
          'step_artifact',
          'running',
          {
            kind: 'tool_call',
            data: {
              event: legacyEvent,
            },
          },
          { stepId, agentRole },
        ),
      )
      return events
    }

    if (type === 'artifact' || type === 'image' || type === 'compression_applied') {
      events.push(...ensureBootEvents())
      events.push(
        nextEvent(
          'step_artifact',
          'running',
          {
            kind: 'result',
            name: type,
            data: legacyEvent,
          },
          { stepId, agentRole },
        ),
      )
      return events
    }

    if (type === 'usage') {
      events.push(...ensureBootEvents())
      const usage = asRecord(legacyEvent.usage)
      if (!usage) return events
      events.push(
        nextEvent('run_metrics', 'running', {
          usage,
          latencyMs: null,
          responseTimeMs: null,
          tokensPerSecond: null,
        }),
      )
      return events
    }

    if (type === 'quota' || type === 'skill_approval_request' || type === 'skill_approval_result') {
      events.push(...ensureBootEvents())
      events.push(
        nextEvent(
          'step_artifact',
          'running',
          {
            kind: 'result',
            name: type,
            data: legacyEvent,
          },
          { stepId, agentRole },
        ),
      )
      return events
    }

    if (type === 'error') {
      events.push(...ensureBootEvents())
      events.push(
        nextEvent(
          'step_complete',
          'error',
          {
            result: {},
            error: asString(legacyEvent.error) || 'Stream failed',
            durationMs: null,
          },
          { stepId, agentRole },
        ),
      )
      events.push(
        nextEvent('run_error', 'error', {
          message: asString(legacyEvent.error) || 'Stream failed',
          details: legacyEvent,
        }),
      )
      events.push(nextEvent('complete', 'error', {}))
      return events
    }

    if (type === 'complete' || type === 'end') {
      events.push(...ensureBootEvents())
      events.push(
        nextEvent(
          'step_complete',
          'completed',
          {
            result: {},
            error: null,
            durationMs: null,
          },
          { stepId, agentRole },
        ),
      )
      events.push(
        nextEvent('run_complete', 'completed', {
          summary: {},
          output: {},
        }),
      )
      events.push(nextEvent('complete', 'completed', {}))
      return events
    }

    return events
  }

  return {
    consume,
  }
}
