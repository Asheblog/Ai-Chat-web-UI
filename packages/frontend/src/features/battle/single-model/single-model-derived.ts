import type { BattleResult } from '@/types'
import type { BattleAttemptDetail } from '../ui/DetailDrawer'
import type { SingleAttemptNodeStatus, SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'
import type { LiveAttempt, QuestionDraft } from './types'

export function buildQuestionViews(params: {
  questions: QuestionDraft[]
  results: BattleResult[]
  liveAttempts: Map<string, LiveAttempt>
}): SingleQuestionTrajectoryView[] {
  const { questions, results, liveAttempts } = params
  return questions.map((question, idx) => {
    const questionIndex = idx + 1
    const attempts = Array.from({ length: question.runsPerQuestion }).map((_, attemptOffset) => {
      const attemptIndex = attemptOffset + 1
      const result = results.find((item) => item.questionIndex === questionIndex && item.attemptIndex === attemptIndex)
      const live = liveAttempts.get(`${questionIndex}#${attemptIndex}`)
      const passed = result?.judgePass === true
      const status: SingleAttemptNodeStatus = result
        ? (result.error ? 'error' : (result.judgeStatus === 'error' ? 'judge_error' : 'done'))
        : live?.status === 'running'
          ? 'running'
          : live?.status === 'judging'
            ? 'judging'
            : live?.status === 'error'
              ? 'error'
              : live?.status === 'success'
                ? 'done'
                : 'pending'

      return {
        attemptIndex,
        status,
        passed,
        score: result?.judgeScore,
        error: result?.error || result?.judgeError || live?.error,
      }
    })

    const passCount = attempts.filter((attempt) => attempt.passed).length
    return {
      questionIndex,
      title: question.title.trim() || `问题 ${questionIndex}`,
      passCount,
      passK: question.passK,
      runsPerQuestion: question.runsPerQuestion,
      passed: passCount >= question.passK,
      attempts,
    }
  })
}

export function buildSelectedNodeKey(selectedAttempt: { questionIndex: number; attemptIndex: number } | null) {
  return selectedAttempt ? `${selectedAttempt.questionIndex}#${selectedAttempt.attemptIndex}` : null
}

export function buildSelectedDetail(params: {
  selectedAttempt: { questionIndex: number; attemptIndex: number } | null
  questions: QuestionDraft[]
  selectedModel: { id?: string; name?: string | null; rawId?: string | null } | null
  results: BattleResult[]
  liveAttempts: Map<string, LiveAttempt>
}): BattleAttemptDetail | null {
  const { selectedAttempt, questions, selectedModel, results, liveAttempts } = params
  if (!selectedAttempt) return null

  const question = questions[selectedAttempt.questionIndex - 1]
  if (!question) return null

  const questionTitle = question.title.trim() || `问题 ${selectedAttempt.questionIndex}`
  const modelLabel = selectedModel?.name || selectedModel?.rawId || '参赛模型'
  const detailLabel = `${questionTitle} · ${modelLabel}`
  const modelKey = `question-${selectedAttempt.questionIndex}`

  const matchedResult = results.find(
    (item) => item.questionIndex === selectedAttempt.questionIndex && item.attemptIndex === selectedAttempt.attemptIndex,
  )
  if (matchedResult) {
    return {
      ...matchedResult,
      modelKey,
      modelLabel: detailLabel,
    }
  }

  const live = liveAttempts.get(`${selectedAttempt.questionIndex}#${selectedAttempt.attemptIndex}`)
  return {
    isLive: true,
    modelKey,
    modelId: selectedModel?.id || 'single-model',
    modelLabel: detailLabel,
    attemptIndex: selectedAttempt.attemptIndex,
    output: live?.output || '',
    reasoning: live?.reasoning || '',
    durationMs: null,
    error: live?.error ?? null,
    status: live?.status || 'pending',
  }
}

export function computeStability(questionViews: SingleQuestionTrajectoryView[]) {
  if (questionViews.length === 0) return 0
  const passedCount = questionViews.filter((item) => item.passed).length
  return passedCount / questionViews.length
}
