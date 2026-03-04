'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Play, Square, Trash2, ListChecks } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useModelsStore, type ModelItem } from '@/store/models-store'
import { cancelBattleRun, streamBattle } from '@/features/battle/api'
import type { BattleResult, BattleRunSummary } from '@/types'

type QuestionDraft = {
  localId: string
  questionId: string
  title: string
  prompt: string
  expectedAnswer: string
  runsPerQuestion: number
  passK: number
}

type LiveAttempt = {
  status: 'pending' | 'running' | 'success' | 'error' | 'judging'
  output: string
  reasoning: string
  error?: string | null
}

const createDefaultQuestion = (): QuestionDraft => ({
  localId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  questionId: '',
  title: '',
  prompt: '',
  expectedAnswer: '',
  runsPerQuestion: 1,
  passK: 1,
})

const modelSelectKey = (model: ModelItem) => `${model.connectionId}:${model.rawId}`

const normalizeInt = (value: string, min: number, max: number, fallback: number) => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function SingleModelMultiQuestionPageClient() {
  const { toast } = useToast()
  const { models } = useModelsStore()

  const [modelKey, setModelKey] = useState<string>('')
  const [judgeKey, setJudgeKey] = useState<string>('')
  const [judgeThreshold, setJudgeThreshold] = useState('0.8')
  const [maxConcurrency, setMaxConcurrency] = useState('3')
  const [questions, setQuestions] = useState<QuestionDraft[]>([createDefaultQuestion()])

  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runId, setRunId] = useState<number | null>(null)
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'completed' | 'error' | 'cancelled'>('idle')
  const [results, setResults] = useState<BattleResult[]>([])
  const [liveAttempts, setLiveAttempts] = useState<Map<string, LiveAttempt>>(new Map())
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  const selectedModel = useMemo(() => models.find((item) => modelSelectKey(item) === modelKey) || null, [models, modelKey])
  const selectedJudge = useMemo(() => models.find((item) => modelSelectKey(item) === judgeKey) || null, [models, judgeKey])

  const updateQuestion = (localId: string, updater: (current: QuestionDraft) => QuestionDraft) => {
    setQuestions((prev) => prev.map((item) => (item.localId === localId ? updater(item) : item)))
  }

  const removeQuestion = (localId: string) => {
    setQuestions((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((item) => item.localId !== localId)
    })
  }

  const validate = () => {
    if (!selectedModel) return '请选择参赛模型'
    if (!selectedJudge) return '请选择裁判模型'
    if (questions.length === 0) return '请至少配置一道题目'

    for (let i = 0; i < questions.length; i += 1) {
      const question = questions[i]
      if (!question.prompt.trim()) return `第 ${i + 1} 题缺少题目内容`
      if (!question.expectedAnswer.trim()) return `第 ${i + 1} 题缺少期望答案`
      if (question.passK > question.runsPerQuestion) return `第 ${i + 1} 题 passK 不能大于 runs`
    }
    return null
  }

  const buildAttemptKey = (questionIndex: number, attemptIndex: number) => `${questionIndex}#${attemptIndex}`

  const handleStart = async () => {
    const validationError = validate()
    if (validationError) {
      toast({ title: validationError, variant: 'destructive' })
      return
    }

    const thresholdValue = Number.parseFloat(judgeThreshold)
    const concurrencyValue = normalizeInt(maxConcurrency, 1, 6, 3)
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 1) {
      toast({ title: '裁判阈值需在 0-1 之间', variant: 'destructive' })
      return
    }

    const controller = new AbortController()
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = controller

    setIsRunning(true)
    setIsStreaming(true)
    setRunStatus('running')
    setRunId(null)
    setSummary(null)
    setResults([])
    setLiveAttempts(new Map())
    setError(null)

    try {
      const payload = {
        mode: 'single_model_multi_question' as const,
        judge: {
          modelId: selectedJudge!.id,
          connectionId: selectedJudge!.connectionId,
          rawId: selectedJudge!.rawId,
        },
        judgeThreshold: thresholdValue,
        model: {
          modelId: selectedModel!.id,
          connectionId: selectedModel!.connectionId,
          rawId: selectedModel!.rawId,
        },
        questions: questions.map((item) => ({
          ...(item.questionId.trim() ? { questionId: item.questionId.trim() } : {}),
          ...(item.title.trim() ? { title: item.title.trim() } : {}),
          prompt: { text: item.prompt.trim() },
          expectedAnswer: { text: item.expectedAnswer.trim() },
          runsPerQuestion: item.runsPerQuestion,
          passK: item.passK,
        })),
        maxConcurrency: concurrencyValue,
      }

      for await (const event of streamBattle(payload, { signal: controller.signal })) {
        if (event.type === 'run_start') {
          const id = Number(event.payload?.id)
          if (Number.isFinite(id)) setRunId(id)
        }

        if (event.type === 'attempt_start') {
          const questionIndex = Number(event.payload?.questionIndex ?? 1)
          const attemptIndex = Number(event.payload?.attemptIndex)
          if (!Number.isFinite(questionIndex) || !Number.isFinite(attemptIndex)) continue
          const key = buildAttemptKey(questionIndex, attemptIndex)
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            next.set(key, {
              status: 'running',
              output: next.get(key)?.output || '',
              reasoning: next.get(key)?.reasoning || '',
              error: null,
            })
            return next
          })
        }

        if (event.type === 'attempt_delta') {
          const questionIndex = Number(event.payload?.questionIndex ?? 1)
          const attemptIndex = Number(event.payload?.attemptIndex)
          if (!Number.isFinite(questionIndex) || !Number.isFinite(attemptIndex)) continue
          const key = buildAttemptKey(questionIndex, attemptIndex)
          const delta = typeof event.payload?.delta === 'string' ? event.payload.delta : ''
          const reasoning = typeof event.payload?.reasoning === 'string' ? event.payload.reasoning : ''
          if (!delta && !reasoning) continue
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            const current = next.get(key) || { status: 'running', output: '', reasoning: '' }
            next.set(key, {
              status: current.status,
              output: `${current.output}${delta}`,
              reasoning: `${current.reasoning}${reasoning}`,
              error: current.error ?? null,
            })
            return next
          })
        }

        if (event.type === 'attempt_complete') {
          const result = event.payload?.result as BattleResult | undefined
          if (!result) continue
          const questionIndex = Number(result.questionIndex ?? event.payload?.questionIndex ?? 1)
          const attemptIndex = Number(result.attemptIndex)
          const key = buildAttemptKey(questionIndex, attemptIndex)
          setResults((prev) => {
            const next = prev.filter((item) => !(item.questionIndex === questionIndex && item.attemptIndex === attemptIndex))
            next.push({ ...result, questionIndex })
            return next
          })
          setLiveAttempts((prev) => {
            const next = new Map(prev)
            next.set(key, {
              status: result.error ? 'error' : (result.judgeStatus === 'error' ? 'error' : 'success'),
              output: result.output || next.get(key)?.output || '',
              reasoning: result.reasoning || next.get(key)?.reasoning || '',
              error: result.error ?? null,
            })
            return next
          })
        }

        if (event.type === 'run_complete') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) setSummary(nextSummary)
          setRunStatus('completed')
        }

        if (event.type === 'run_cancelled') {
          const nextSummary = event.payload?.summary as BattleRunSummary['summary'] | undefined
          if (nextSummary) setSummary(nextSummary)
          setRunStatus('cancelled')
          setIsRunning(false)
        }

        if (event.type === 'error') {
          setError(event.error || '执行失败')
          setRunStatus('error')
          setIsRunning(false)
        }

        if (event.type === 'complete') {
          setIsRunning(false)
          setRunStatus((prev) => (prev === 'error' || prev === 'cancelled' ? prev : 'completed'))
        }
      }
    } catch (err: any) {
      if (controller.signal.aborted) {
        setRunStatus('cancelled')
      } else {
        const message = err?.message || '执行失败'
        setError(message)
        setRunStatus('error')
      }
      setIsRunning(false)
    } finally {
      setIsStreaming(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const handleCancel = async () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (runId) {
      try {
        await cancelBattleRun(runId)
      } catch {
        // ignore
      }
    }
    setIsRunning(false)
    setIsStreaming(false)
    setRunStatus('cancelled')
  }

  const questionViews = useMemo(() => {
    return questions.map((question, idx) => {
      const questionIndex = idx + 1
      const attempts = Array.from({ length: question.runsPerQuestion }).map((_, attemptOffset) => {
        const attemptIndex = attemptOffset + 1
        const result = results.find((item) => item.questionIndex === questionIndex && item.attemptIndex === attemptIndex)
        const live = liveAttempts.get(buildAttemptKey(questionIndex, attemptIndex))
        const passed = result?.judgePass === true
        const status = result
          ? (result.error ? 'error' : (result.judgeStatus === 'error' ? 'judge_error' : 'done'))
          : live?.status || 'pending'
        return {
          attemptIndex,
          status,
          passed,
          score: result?.judgeScore,
          error: result?.error || result?.judgeError || live?.error,
        }
      })
      const passCount = attempts.filter((item) => item.passed).length
      const passed = passCount >= question.passK
      return {
        questionIndex,
        title: question.title.trim() || `问题 ${questionIndex}`,
        passCount,
        passK: question.passK,
        runsPerQuestion: question.runsPerQuestion,
        passed,
        attempts,
      }
    })
  }, [questions, results, liveAttempts])

  const computedStability = useMemo(() => {
    if (questionViews.length === 0) return 0
    const passedCount = questionViews.filter((item) => item.passed).length
    return passedCount / questionViews.length
  }, [questionViews])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[hsl(var(--background-alt))/0.32]">
      <div className="mx-auto w-full max-w-[1200px] space-y-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <Link href="/main/battle" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回模式选择
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">单模型多问题大乱斗</h1>
            <p className="text-sm text-muted-foreground">给一个模型批量出题，观察按题通过率稳定性</p>
          </div>
          <Badge variant={runStatus === 'running' ? 'default' : runStatus === 'error' ? 'destructive' : 'secondary'}>
            {runStatus === 'idle' ? '未开始' : runStatus === 'running' ? '运行中' : runStatus === 'completed' ? '已完成' : runStatus === 'cancelled' ? '已取消' : '失败'}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>运行配置</CardTitle>
            <CardDescription>选择参赛模型、裁判模型与并发参数</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>参赛模型</Label>
              <Select value={modelKey} onValueChange={setModelKey} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={`model-${item.connectionId}-${item.rawId}`} value={modelSelectKey(item)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>裁判模型</Label>
              <Select value={judgeKey} onValueChange={setJudgeKey} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue placeholder="选择裁判" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((item) => (
                    <SelectItem key={`judge-${item.connectionId}-${item.rawId}`} value={modelSelectKey(item)}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>裁判阈值 (0-1)</Label>
              <Input value={judgeThreshold} onChange={(e) => setJudgeThreshold(e.target.value)} disabled={isRunning} />
            </div>

            <div className="space-y-2">
              <Label>并发上限 (1-6)</Label>
              <Input value={maxConcurrency} onChange={(e) => setMaxConcurrency(e.target.value)} disabled={isRunning} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4" />题目列表</CardTitle>
              <CardDescription>每题独立设置 runs 与 passK（最多 3）</CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => setQuestions((prev) => [...prev, createDefaultQuestion()])}
              disabled={isRunning || questions.length >= 50}
            >
              <Plus className="mr-2 h-4 w-4" />新增题目
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {questions.map((question, idx) => (
              <div key={question.localId} className="rounded-lg border border-border/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">题目 {idx + 1}</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeQuestion(question.localId)}
                    disabled={isRunning || questions.length <= 1}
                  >
                    <Trash2 className="mr-1 h-4 w-4" />删除
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Question ID（可选）</Label>
                    <Input
                      value={question.questionId}
                      onChange={(e) => updateQuestion(question.localId, (curr) => ({ ...curr, questionId: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>标题（可选）</Label>
                    <Input
                      value={question.title}
                      onChange={(e) => updateQuestion(question.localId, (curr) => ({ ...curr, title: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label>题目</Label>
                    <Textarea
                      rows={5}
                      value={question.prompt}
                      onChange={(e) => updateQuestion(question.localId, (curr) => ({ ...curr, prompt: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>期望答案</Label>
                    <Textarea
                      rows={5}
                      value={question.expectedAnswer}
                      onChange={(e) => updateQuestion(question.localId, (curr) => ({ ...curr, expectedAnswer: e.target.value }))}
                      disabled={isRunning}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Runs (1-3)</Label>
                    <Input
                      value={String(question.runsPerQuestion)}
                      onChange={(e) => {
                        const runs = normalizeInt(e.target.value, 1, 3, question.runsPerQuestion)
                        updateQuestion(question.localId, (curr) => ({
                          ...curr,
                          runsPerQuestion: runs,
                          passK: Math.min(curr.passK, runs),
                        }))
                      }}
                      disabled={isRunning}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Pass K (1-3)</Label>
                    <Input
                      value={String(question.passK)}
                      onChange={(e) => {
                        const passK = normalizeInt(e.target.value, 1, 3, question.passK)
                        updateQuestion(question.localId, (curr) => ({
                          ...curr,
                          passK: Math.min(passK, curr.runsPerQuestion),
                        }))
                      }}
                      disabled={isRunning}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleStart} disabled={isRunning}>
            <Play className="mr-2 h-4 w-4" />开始评测
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={!isRunning || !isStreaming}>
            <Square className="mr-2 h-4 w-4" />取消
          </Button>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>结果总览</CardTitle>
            <CardDescription>
              {summary?.stabilityScore != null
                ? `稳定性 ${(summary.stabilityScore * 100).toFixed(1)}%（${summary.passedQuestions ?? 0}/${summary.totalQuestions ?? 0}）`
                : `稳定性 ${(computedStability * 100).toFixed(1)}%`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {questionViews.map((item) => (
              <div key={`result-question-${item.questionIndex}`} className="rounded-lg border border-border/70 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{item.title}</div>
                  <Badge variant={item.passed ? 'default' : 'secondary'}>
                    {item.passCount}/{item.runsPerQuestion} 通过（K={item.passK}）
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.attempts.map((attempt) => (
                    <Badge
                      key={`attempt-${item.questionIndex}-${attempt.attemptIndex}`}
                      variant={attempt.passed ? 'default' : (attempt.status === 'error' || attempt.status === 'judge_error') ? 'destructive' : 'secondary'}
                    >
                      #{attempt.attemptIndex}
                      {attempt.status === 'running' || attempt.status === 'judging'
                        ? ' 运行中'
                        : attempt.passed
                          ? ` ✓ ${attempt.score != null ? attempt.score.toFixed(2) : '--'}`
                          : attempt.status === 'done' || attempt.status === 'judge_error'
                            ? ` ✗ ${attempt.score != null ? attempt.score.toFixed(2) : '--'}`
                            : attempt.status === 'error'
                              ? ' 失败'
                              : ' 待执行'}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
