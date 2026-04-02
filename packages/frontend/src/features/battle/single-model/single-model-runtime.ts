import type { BattleRunDetail } from '@/types'
import type { QuestionDraft } from './types'

export const clampPassSettings = (runsPerQuestion: number, passK: number) => {
  const nextRuns = Math.min(3, Math.max(1, Math.floor(runsPerQuestion)))
  const nextPass = Math.min(nextRuns, Math.max(1, Math.floor(passK)))
  return { runsPerQuestion: nextRuns, passK: nextPass }
}

export const parseExecutionStepIdentity = (stepId: unknown): { questionIndex: number; attemptIndex: number } | null => {
  if (typeof stepId !== 'string' || stepId.trim().length === 0) return null
  const matched = stepId.match(/:q(\d+):a(\d+)$/)
  if (!matched) return null

  const questionIndex = Number.parseInt(matched[1], 10)
  const attemptIndex = Number.parseInt(matched[2], 10)
  if (!Number.isFinite(questionIndex) || !Number.isFinite(attemptIndex) || questionIndex <= 0 || attemptIndex <= 0) {
    return null
  }

  return { questionIndex, attemptIndex }
}

export function buildQuestionsFromRunDetail(
  detail: BattleRunDetail,
  createLocalId: (index: number) => string,
): QuestionDraft[] {
  const fromConfig = Array.isArray(detail.config?.questions) ? detail.config.questions : []
  if (fromConfig.length > 0) {
    return fromConfig.map((item, index) => {
      const { runsPerQuestion, passK } = clampPassSettings(item.runsPerQuestion ?? 1, item.passK ?? 1)
      return {
        localId: createLocalId(index),
        questionId: item.questionId || '',
        title: item.title || '',
        prompt: item.prompt?.text || '',
        expectedAnswer: item.expectedAnswer?.text || '',
        runsPerQuestion,
        passK,
      }
    })
  }

  const { runsPerQuestion, passK } = clampPassSettings(detail.runsPerModel ?? 1, detail.passK ?? 1)
  return [{
    localId: createLocalId(0),
    questionId: '',
    title: '',
    prompt: detail.prompt?.text || '',
    expectedAnswer: detail.expectedAnswer?.text || '',
    runsPerQuestion,
    passK,
  }]
}
