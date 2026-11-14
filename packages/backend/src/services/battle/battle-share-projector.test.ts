import { BattleShareProjector, type BattleShareLiveAttempt } from './battle-share-projector'
import type { BattleRunRecord, BattleRunSummary } from './battle-types'

const buildProjector = () =>
  new BattleShareProjector({
    parseRunConfigPayload: () => ({}),
    normalizeMode: () => 'multi_model_same_question' as never,
    normalizeQuestions: () => [],
    parseImagePaths: () => [],
    toBattleContent: (text, images) => ({ text, images }),
    composeModelLabel: () => null,
    normalizeRunStatus: () => 'completed' as never,
    safeParseUsage: () => ({}),
    buildAttemptKey: (modelKey, questionIndex, attemptIndex) =>
      `${modelKey}#${questionIndex}#${attemptIndex}`,
    buildModelKey: (modelId, connectionId, rawId) =>
      `${modelId}:${connectionId ?? 'null'}:${rawId ?? 'null'}`,
  })

const run = {
  id: 1,
  mode: 'multi_model_same_question',
  title: 'Battle',
  prompt: 'p',
  expectedAnswer: 'e',
  promptImagesJson: null,
  expectedAnswerImagesJson: null,
  judgeModelId: 'judge',
  judgeConnectionId: null,
  judgeRawId: null,
  judgeThreshold: 60,
  runsPerModel: 1,
  passK: 1,
  status: 'completed',
  configJson: '{}',
  summaryJson: '{}',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as BattleRunRecord

const summary = {
  questionStats: [],
  totalAttempts: 1,
  completedAttempts: 1,
} as unknown as BattleRunSummary

const liveAttempt = (overrides: Partial<BattleShareLiveAttempt>): BattleShareLiveAttempt => ({
  questionIndex: 1,
  questionId: null,
  questionTitle: null,
  modelId: 'model-a',
  modelLabel: null,
  connectionId: null,
  rawId: null,
  attemptIndex: 1,
  status: 'success',
  output: 'answer',
  reasoning: '',
  durationMs: 10,
  error: null,
  toolEvents: [],
  ...overrides,
})

const toolEvent = {
  id: 'call_p',
  callId: 'call_p',
  tool: 'web_search',
  stage: 'result' as const,
  status: 'error' as const,
  createdAt: 1000,
  details: { parentCallId: 'root', fallbackUsed: 'search_snippet' },
}

describe('BattleShareProjector 调用记录一致性', () => {
  const buildPayload = (
    projector: BattleShareProjector,
    params: { liveAttempts: BattleShareLiveAttempt[] | null; runResult?: any },
  ) =>
    projector.buildSharePayload({
      run,
      summary,
      results: [],
      models: [{ modelId: 'model-a', connectionId: null, rawId: null }],
      connectionMap: new Map(),
      judgeConnection: null,
      liveAttempts: params.liveAttempts,
      ...(params.runResult ? { runResult: params.runResult } : {}),
    })

  it('保留尝试级工具事件的身份/父子/状态并给出覆盖', () => {
    const projector = buildProjector()
    const payload = buildPayload(projector, {
      liveAttempts: [liveAttempt({ toolEvents: [toolEvent] })],
    })

    const attempt = payload.live?.attempts[0]
    expect(attempt?.toolEvents).toEqual([toolEvent])
    expect(attempt?.toolEventsCoverage).toEqual({
      trace: { status: 'unknown' },
      persisted: { status: 'complete' },
      projection: { status: 'complete' },
    })
  })

  it('未结束的尝试覆盖为 partial，不宣称记录已完整', () => {
    const projector = buildProjector()
    const payload = buildPayload(projector, {
      liveAttempts: [liveAttempt({ status: 'running', toolEvents: [toolEvent] })],
    })
    expect(payload.live?.attempts[0]?.toolEventsCoverage?.persisted.status).toBe('partial')
    expect(payload.live?.attempts[0]?.toolEventsCoverage?.trace.status).toBe('unknown')
  })

  it('没有工具事件的尝试不写工具事件与覆盖字段', () => {
    const projector = buildProjector()
    const payload = buildPayload(projector, { liveAttempts: [liveAttempt({})] })
    const attempt = payload.live?.attempts[0] as Record<string, unknown>
    expect(attempt).not.toHaveProperty('toolEvents')
    expect(attempt).not.toHaveProperty('toolEventsCoverage')
  })

  it('没有真实 runResult 时不写字段，有值时原样透出', () => {
    const projector = buildProjector()
    expect(buildPayload(projector, { liveAttempts: null })).not.toHaveProperty('runResult')

    const payload = buildPayload(projector, {
      liveAttempts: null,
      runResult: { stopReason: 'budget_exhausted', finalAnswerGenerated: false },
    })
    expect(payload.runResult).toEqual({
      stopReason: 'budget_exhausted',
      finalAnswerGenerated: false,
    })
  })
})
