import type { BattleRunSummary } from '@/types'
import type { SingleQuestionTrajectoryView } from './QuestionTrajectoryGraph'
import type { SingleModelRunStatus } from './types'

export function getVisibleHistoryItems(
  history: BattleRunSummary[],
  expanded: boolean,
  limit = 3,
) {
  return expanded ? history : history.slice(0, limit)
}

export function buildMonitorStats(
  questions: SingleQuestionTrajectoryView[],
  runStatus: SingleModelRunStatus,
) {
  let completedAttempts = 0
  let activeAttempts = 0
  let pendingAttempts = 0

  for (const question of questions) {
    for (const attempt of question.attempts) {
      if (attempt.status === 'pending') {
        pendingAttempts += 1
        continue
      }
      if (attempt.status === 'running' || attempt.status === 'judging') {
        activeAttempts += 1
        continue
      }
      completedAttempts += 1
    }
  }

  const totalAttempts = completedAttempts + activeAttempts + pendingAttempts
  const passedQuestions = questions.filter((question) => question.passed).length

  return {
    runStatus,
    totalQuestions: questions.length,
    totalAttempts,
    completedAttempts,
    activeAttempts,
    pendingAttempts,
    passedQuestions,
    failedQuestions: Math.max(0, questions.length - passedQuestions),
    progressPercent: totalAttempts > 0 ? (completedAttempts / totalAttempts) * 100 : 0,
  }
}
