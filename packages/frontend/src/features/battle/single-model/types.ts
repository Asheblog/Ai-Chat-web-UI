export type QuestionDraft = {
  localId: string
  questionId: string
  title: string
  prompt: string
  expectedAnswer: string
  runsPerQuestion: number
  passK: number
}

export type LiveAttempt = {
  status: 'pending' | 'running' | 'success' | 'error' | 'judging'
  output: string
  reasoning: string
  error?: string | null
}

export type SingleModelRunStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'cancelled'

export type SelectedAttempt = {
  questionIndex: number
  attemptIndex: number
}
