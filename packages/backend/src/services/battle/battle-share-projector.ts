import type {
  BattleContent,
  BattleMode,
  BattleRunStatus,
  BattleToolCallEvent,
} from '@aichat/shared/battle-contract'
import type {
  BattleResultRecord,
  BattleRunConfigModel,
  BattleRunQuestionConfig,
  BattleRunRecord,
  BattleRunSummary,
  BattleSharePayload,
} from './battle-types'

export interface BattleShareLabelConnection {
  id: number
  prefixId: string | null
}

export interface BattleShareLiveAttempt {
  questionIndex: number
  questionId: string | null
  questionTitle: string | null
  modelId: string
  modelLabel: string | null
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

export class BattleShareProjector {
  constructor(
    private readonly deps: {
      parseRunConfigPayload: (raw: string | null | undefined) => Record<string, any>
      normalizeMode: (value: unknown) => BattleMode
      normalizeQuestions: (raw: unknown) => BattleRunQuestionConfig[]
      parseImagePaths: (raw: string | null | undefined) => string[]
      toBattleContent: (text: string, imagePaths: string[]) => BattleContent
      composeModelLabel: (
        connection: Pick<BattleShareLabelConnection, 'prefixId'> | null,
        rawId?: string | null,
        fallback?: string | null,
      ) => string | null
      normalizeRunStatus: (value: string | null | undefined) => BattleRunStatus
      safeParseUsage: (raw: string | null | undefined) => Record<string, any>
      buildAttemptKey: (modelKey: string, questionIndex: number, attemptIndex: number) => string
      buildModelKey: (modelId: string, connectionId?: number | null, rawId?: string | null) => string
    },
  ) {}

  buildShareModels(
    configModels: BattleRunConfigModel[],
    results: BattleResultRecord[],
    configModel?: BattleRunConfigModel | null,
  ): BattleRunConfigModel[] {
    if (configModels.length > 0) return configModels
    if (configModel) return [configModel]
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
    return Array.from(fallbackModels.values())
  }

  buildShareProgress(params: {
    mode: BattleMode
    summary: BattleRunSummary
    modelCount: number
    runsPerModel: number
    results: BattleResultRecord[]
    liveAttempts: BattleShareLiveAttempt[] | null
  }) {
    const totalAttempts = params.mode === 'single_model_multi_question'
      ? (params.summary.questionStats || []).reduce(
        (acc, item) => acc + Math.max(0, Math.floor(item.runsPerQuestion || 0)),
        0,
      )
      : Math.max(0, params.modelCount) * Math.max(1, Math.floor(params.runsPerModel))
    const completedAttempts = params.results.length
    let successAttempts = 0
    let failedAttempts = 0
    for (const result of params.results) {
      if (!result.error && result.judgePass === true) {
        successAttempts += 1
      } else {
        failedAttempts += 1
      }
    }

    const resultKeys = new Set(
      params.results.map((item) =>
        this.deps.buildAttemptKey(
          this.deps.buildModelKey(item.modelId, item.connectionId, item.rawId),
          item.questionIndex ?? 1,
          item.attemptIndex,
        ),
      ),
    )
    let runningAttempts = 0
    let pendingAttempts = 0
    if (params.liveAttempts) {
      for (const attempt of params.liveAttempts) {
        const key = this.deps.buildAttemptKey(
          this.deps.buildModelKey(attempt.modelId, attempt.connectionId, attempt.rawId),
          attempt.questionIndex ?? 1,
          attempt.attemptIndex,
        )
        if (resultKeys.has(key)) continue
        if (attempt.status === 'running' || attempt.status === 'judging') {
          runningAttempts += 1
          continue
        }
        if (attempt.status === 'pending') {
          pendingAttempts += 1
        }
      }
    }

    const remaining = Math.max(0, totalAttempts - completedAttempts - runningAttempts - pendingAttempts)
    pendingAttempts += remaining

    return {
      totalAttempts,
      completedAttempts,
      runningAttempts,
      pendingAttempts,
      successAttempts,
      failedAttempts,
    }
  }

  buildSharePayload(params: {
    run: BattleRunRecord
    summary: BattleRunSummary
    results: BattleResultRecord[]
    models: BattleRunConfigModel[]
    connectionMap: Map<number, BattleShareLabelConnection>
    judgeConnection: BattleShareLabelConnection | null
    liveAttempts: BattleShareLiveAttempt[] | null
  }): BattleSharePayload {
    const rawConfig = this.deps.parseRunConfigPayload(params.run.configJson)
    const mode = this.deps.normalizeMode(rawConfig.mode ?? params.run.mode)
    const questionConfigs = this.deps.normalizeQuestions(rawConfig.questions)
    const promptImagePaths = this.deps.parseImagePaths(params.run.promptImagesJson)
    const expectedAnswerImagePaths = this.deps.parseImagePaths(params.run.expectedAnswerImagesJson)
    const models = params.models.map((model) => ({
      modelId: model.modelId,
      modelLabel: this.deps.composeModelLabel(
        model.connectionId != null ? params.connectionMap.get(model.connectionId) || null : null,
        model.rawId,
        model.modelId,
      ),
      connectionId: model.connectionId ?? null,
      rawId: model.rawId ?? null,
    }))
    const questions = questionConfigs.length > 0
      ? questionConfigs.map((item) => ({
        questionIndex: item.questionIndex,
        questionId: item.questionId ?? null,
        title: item.title ?? null,
        prompt: this.deps.toBattleContent(item.prompt.text, item.prompt.images),
        expectedAnswer: this.deps.toBattleContent(item.expectedAnswer.text, item.expectedAnswer.images),
        runsPerQuestion: item.runsPerQuestion,
        passK: item.passK,
      }))
      : undefined
    const progressSummary = mode === 'single_model_multi_question'
      && (!params.summary.questionStats || params.summary.questionStats.length === 0)
      ? {
        ...params.summary,
        questionStats: questionConfigs.map((item) => ({
          questionIndex: item.questionIndex,
          questionId: item.questionId ?? null,
          questionTitle: item.title ?? null,
          runsPerQuestion: item.runsPerQuestion,
          passK: item.passK,
          passAtK: false,
          passCount: 0,
          accuracy: 0,
          judgedCount: 0,
          totalAttempts: item.runsPerQuestion,
          judgeErrorCount: 0,
        })),
      }
      : params.summary
    const progress = this.buildShareProgress({
      mode,
      summary: progressSummary,
      modelCount: models.length,
      runsPerModel: params.run.runsPerModel,
      results: params.results,
      liveAttempts: params.liveAttempts,
    })
    const live = params.liveAttempts && params.liveAttempts.length > 0
      ? {
        attempts: params.liveAttempts.map((attempt) => ({
          questionIndex: attempt.questionIndex,
          questionId: attempt.questionId ?? null,
          questionTitle: attempt.questionTitle ?? null,
          modelId: attempt.modelId,
          modelLabel: attempt.modelLabel ?? null,
          connectionId: attempt.connectionId,
          rawId: attempt.rawId,
          attemptIndex: attempt.attemptIndex,
          status: attempt.status,
          output: attempt.output,
          reasoning: attempt.reasoning,
          durationMs: attempt.durationMs,
          error: attempt.error,
          ...(attempt.toolEvents.length > 0 ? { toolEvents: attempt.toolEvents } : {}),
        })),
      }
      : undefined
    return {
      title: params.run.title,
      mode,
      prompt: this.deps.toBattleContent(params.run.prompt, promptImagePaths),
      expectedAnswer: this.deps.toBattleContent(params.run.expectedAnswer, expectedAnswerImagePaths),
      judge: {
        modelId: params.run.judgeModelId,
        modelLabel: this.deps.composeModelLabel(params.judgeConnection, params.run.judgeRawId, params.run.judgeModelId),
        threshold: params.run.judgeThreshold,
      },
      status: this.deps.normalizeRunStatus(params.run.status),
      progress,
      models,
      ...(questions ? { questions } : {}),
      summary: params.summary,
      results: params.results.map((item) => ({
        questionIndex: item.questionIndex ?? 1,
        questionId: item.questionId ?? null,
        questionTitle: item.questionTitle ?? null,
        modelId: item.modelId,
        modelLabel: this.deps.composeModelLabel(params.connectionMap.get(item.connectionId || -1) || null, item.rawId, item.modelId),
        connectionId: item.connectionId,
        rawId: item.rawId,
        attemptIndex: item.attemptIndex,
        output: item.output,
        reasoning: item.reasoning || '',
        durationMs: item.durationMs,
        error: item.error,
        usage: this.deps.safeParseUsage(item.usageJson),
        judgeStatus: item.judgeStatus as any,
        judgeError: item.judgeError,
        judgePass: item.judgePass,
        judgeScore: item.judgeScore,
        judgeReason: item.judgeReason,
        judgeFallbackUsed: item.judgeFallbackUsed,
      })),
      ...(live ? { live } : {}),
      createdAt: params.run.createdAt.toISOString(),
    }
  }
}
