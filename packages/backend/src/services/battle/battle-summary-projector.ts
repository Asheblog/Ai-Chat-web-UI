import type { BattleMode } from '@aichat/shared/battle-contract'
import type {
  BattleResultRecord,
  BattleRunQuestionConfig,
  BattleRunSummary,
} from './battle-types'

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

export class BattleSummaryProjector {
  constructor(
    private readonly deps: {
      normalizeMode: (value: unknown) => BattleMode
    },
  ) {}

  normalizeSummary(
    raw: unknown,
    defaults: { runsPerModel: number; passK: number; judgeThreshold: number },
  ): BattleRunSummary {
    const data = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {}
    const rawStats = Array.isArray(data.modelStats) ? data.modelStats : []
    const modelStats = rawStats
      .map((item): BattleRunSummary['modelStats'][number] | null => {
        if (!item || typeof item !== 'object') return null
        const stats = item as Record<string, any>
        const modelId = typeof stats.modelId === 'string' ? stats.modelId : ''
        if (!modelId) return null
        const accuracy = isFiniteNumber(stats.accuracy) ? clamp(stats.accuracy, 0, 1) : 0
        return {
          modelId,
          connectionId: isFiniteNumber(stats.connectionId) ? stats.connectionId : null,
          rawId: typeof stats.rawId === 'string' && stats.rawId.trim().length > 0 ? stats.rawId : null,
          passAtK: Boolean(stats.passAtK),
          passCount: isFiniteNumber(stats.passCount) ? stats.passCount : 0,
          accuracy,
          judgedCount: isFiniteNumber(stats.judgedCount) ? Math.max(0, Math.floor(stats.judgedCount)) : undefined,
          totalAttempts: isFiniteNumber(stats.totalAttempts) ? Math.max(0, Math.floor(stats.totalAttempts)) : undefined,
          judgeErrorCount: isFiniteNumber(stats.judgeErrorCount) ? Math.max(0, Math.floor(stats.judgeErrorCount)) : undefined,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

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
    const mode = this.deps.normalizeMode(data.mode) || undefined
    const totalQuestions = isFiniteNumber(data.totalQuestions) ? Math.max(0, Math.floor(data.totalQuestions)) : undefined
    const passedQuestions = isFiniteNumber(data.passedQuestions) ? Math.max(0, Math.floor(data.passedQuestions)) : undefined
    const stabilityScore = isFiniteNumber(data.stabilityScore) ? clamp(data.stabilityScore, 0, 1) : undefined
    const rawQuestionStats = Array.isArray(data.questionStats) ? data.questionStats : []
    const questionStats = rawQuestionStats
      .map((item): NonNullable<BattleRunSummary['questionStats']>[number] | null => {
        if (!item || typeof item !== 'object') return null
        const stats = item as Record<string, any>
        const questionIndex = isFiniteNumber(stats.questionIndex) ? Math.max(1, Math.floor(stats.questionIndex)) : null
        if (!questionIndex) return null
        return {
          questionIndex,
          questionId: typeof stats.questionId === 'string' && stats.questionId.trim() ? stats.questionId.trim() : null,
          questionTitle: typeof stats.questionTitle === 'string' && stats.questionTitle.trim() ? stats.questionTitle.trim() : null,
          runsPerQuestion: isFiniteNumber(stats.runsPerQuestion) ? Math.max(1, Math.floor(stats.runsPerQuestion)) : 1,
          passK: isFiniteNumber(stats.passK) ? Math.max(1, Math.floor(stats.passK)) : 1,
          passAtK: Boolean(stats.passAtK),
          passCount: isFiniteNumber(stats.passCount) ? Math.max(0, Math.floor(stats.passCount)) : 0,
          accuracy: isFiniteNumber(stats.accuracy) ? clamp(stats.accuracy, 0, 1) : 0,
          judgedCount: isFiniteNumber(stats.judgedCount) ? Math.max(0, Math.floor(stats.judgedCount)) : undefined,
          totalAttempts: isFiniteNumber(stats.totalAttempts) ? Math.max(0, Math.floor(stats.totalAttempts)) : undefined,
          judgeErrorCount: isFiniteNumber(stats.judgeErrorCount) ? Math.max(0, Math.floor(stats.judgeErrorCount)) : undefined,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)

    return {
      totalModels,
      runsPerModel,
      passK,
      judgeThreshold,
      passModelCount,
      accuracy: clamp(accuracy, 0, 1),
      ...(mode ? { mode } : {}),
      ...(typeof totalQuestions === 'number' ? { totalQuestions } : {}),
      ...(typeof passedQuestions === 'number' ? { passedQuestions } : {}),
      ...(typeof stabilityScore === 'number' ? { stabilityScore } : {}),
      ...(questionStats.length > 0 ? { questionStats } : {}),
      modelStats,
    }
  }

  buildSummary(
    results: BattleResultRecord[],
    runsPerModel: number,
    passK: number,
    judgeThreshold: number,
    options?: {
      mode?: BattleMode
      questionConfigs?: BattleRunQuestionConfig[]
    },
  ): BattleRunSummary {
    const mode = this.deps.normalizeMode(options?.mode)
    if (mode === 'single_model_multi_question') {
      return this.buildSingleModelQuestionSummary(results, judgeThreshold, options?.questionConfigs || [])
    }

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
      mode: 'multi_model',
      modelStats,
    }
  }

  private buildSingleModelQuestionSummary(
    results: BattleResultRecord[],
    judgeThreshold: number,
    questionConfigs: BattleRunQuestionConfig[],
  ): BattleRunSummary {
    const questionGroups = new Map<number, {
      questionIndex: number
      questionId: string | null
      questionTitle: string | null
      runsPerQuestion: number
      passK: number
      passCount: number
      judgedCount: number
      totalAttempts: number
      judgeErrorCount: number
    }>()

    for (const result of results) {
      const config = questionConfigs.find((item) => item.questionIndex === result.questionIndex)
      const group = questionGroups.get(result.questionIndex) || {
        questionIndex: result.questionIndex,
        questionId: result.questionId ?? config?.questionId ?? null,
        questionTitle: result.questionTitle ?? config?.title ?? null,
        runsPerQuestion: config?.runsPerQuestion ?? 1,
        passK: config?.passK ?? 1,
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
      questionGroups.set(result.questionIndex, group)
    }

    for (const config of questionConfigs) {
      if (questionGroups.has(config.questionIndex)) continue
      questionGroups.set(config.questionIndex, {
        questionIndex: config.questionIndex,
        questionId: config.questionId ?? null,
        questionTitle: config.title ?? null,
        runsPerQuestion: config.runsPerQuestion,
        passK: config.passK,
        passCount: 0,
        judgedCount: 0,
        totalAttempts: 0,
        judgeErrorCount: 0,
      })
    }

    const questionStats = Array.from(questionGroups.values())
      .sort((a, b) => a.questionIndex - b.questionIndex)
      .map((group) => {
        const accuracy = group.totalAttempts > 0 ? group.passCount / group.totalAttempts : 0
        return {
          questionIndex: group.questionIndex,
          questionId: group.questionId,
          questionTitle: group.questionTitle,
          runsPerQuestion: group.runsPerQuestion,
          passK: group.passK,
          passAtK: group.passCount >= group.passK,
          passCount: group.passCount,
          accuracy,
          judgedCount: group.judgedCount,
          totalAttempts: group.totalAttempts,
          judgeErrorCount: group.judgeErrorCount,
        }
      })
    const totalQuestions = questionStats.length
    const passedQuestions = questionStats.filter((item) => item.passAtK).length
    const stabilityScore = totalQuestions > 0 ? passedQuestions / totalQuestions : 0

    const first = results[0]
    const judgedCount = questionStats.reduce((acc, item) => acc + (item.judgedCount || 0), 0)
    const totalAttempts = questionStats.reduce((acc, item) => acc + (item.totalAttempts || 0), 0)
    const judgeErrorCount = questionStats.reduce((acc, item) => acc + (item.judgeErrorCount || 0), 0)
    const modelStats = first
      ? [{
        modelId: first.modelId,
        connectionId: first.connectionId ?? null,
        rawId: first.rawId ?? null,
        passAtK: totalQuestions > 0 ? passedQuestions === totalQuestions : false,
        passCount: passedQuestions,
        accuracy: stabilityScore,
        judgedCount,
        totalAttempts,
        judgeErrorCount,
      }]
      : []

    return {
      totalModels: modelStats.length,
      runsPerModel: 1,
      passK: 1,
      judgeThreshold,
      passModelCount: modelStats.length > 0 && modelStats[0].passAtK ? 1 : 0,
      accuracy: modelStats.length > 0 ? modelStats[0].accuracy : 0,
      mode: 'single_model_multi_question',
      totalQuestions,
      passedQuestions,
      stabilityScore,
      questionStats,
      modelStats,
    }
  }
}
