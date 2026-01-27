'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'
import { useModelsStore } from '@/store/models-store'
import { History, Trash2, Eye, Trophy } from 'lucide-react'
import type { BattleResult, BattleRunDetail, BattleRunSummary } from '@/types'
import { createBattleShare, deleteBattleRun, getBattleRun, listBattleRuns, retryBattleJudgeResult, retryBattleJudgeRun } from './api'
import { FlowStepper } from './ui/FlowStepper'
import { ConfigStep } from './ui/ConfigStep'
import { PromptStep } from './ui/PromptStep'
import { ExecutionStep } from './ui/ExecutionStep'
import { ResultStep } from './ui/ResultStep'
import { DetailDrawer, type BattleAttemptDetail } from './ui/DetailDrawer'
import { useBattleFlow, type BattleStep } from './hooks/useBattleFlow'
import './battle.css'
import { buildModelKey, parseModelKey } from './utils/model-key'

const RUN_STORAGE_KEY = 'battle:active-run-id'
const LAST_VIEWED_RUN_KEY = 'battle:last-viewed-run-id'

export function BattlePageClient() {
  const { toast } = useToast()
  const { models } = useModelsStore()

  // Battle flow state
  const flow = useBattleFlow()

  // History state
  const [history, setHistory] = useState<BattleRunSummary[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [shareLink, setShareLink] = useState<string | null>(null)
  const [retryingJudgeResultId, setRetryingJudgeResultId] = useState<number | null>(null)
  const [retryingJudgeRun, setRetryingJudgeRun] = useState(false)
  const [selectedNode, setSelectedNode] = useState<{ modelKey: string; attemptIndex: number } | null>(null)
  const restoredRef = useRef(false)

  // Fetch history
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await listBattleRuns({ page: 1, limit: 20 })
      if (res?.success && res.data) {
        setHistory(res.data.runs)
      }
    } catch (error: any) {
      toast({ title: error?.message || '加载乱斗历史失败', variant: 'destructive' })
    } finally {
      setHistoryLoading(false)
    }
  }, [toast])

  useEffect(() => {
    refreshHistory()
  }, [])

  useEffect(() => {
    if (models.length === 0) return
    flow.reconcileSelectedModels(models)
  }, [models, flow.reconcileSelectedModels])

  const applyRunDetail = useCallback((detail: BattleRunDetail) => {
    flow.loadRun({
      id: detail.id,
      prompt: detail.prompt,
      expectedAnswer: detail.expectedAnswer,
      judgeModelId: detail.judgeModelId,
      judgeConnectionId: detail.judgeConnectionId ?? null,
      judgeRawId: detail.judgeRawId ?? null,
      judgeThreshold: detail.judgeThreshold ?? 0.8,
      runsPerModel: detail.runsPerModel ?? 1,
      passK: detail.passK ?? 1,
      summary: detail.summary,
      results: detail.results || [],
      status: detail.status,
      config: detail.config,
      live: detail.live,
    }, models)
  }, [flow.loadRun, models])

  const handleNodeClick = useCallback((modelKey: string, attemptIndex: number) => {
    setSelectedNode({ modelKey, attemptIndex })
  }, [])

  const handleSelectResult = useCallback((result: BattleResult) => {
    setSelectedNode({
      modelKey: buildModelKey({
        modelId: result.modelId,
        connectionId: result.connectionId,
        rawId: result.rawId,
      }),
      attemptIndex: result.attemptIndex,
    })
  }, [])

  const selectedNodeKey = selectedNode ? `${selectedNode.modelKey}-${selectedNode.attemptIndex}` : null

  const selectedDetail = useMemo<BattleAttemptDetail | null>(() => {
    if (!selectedNode) return null
    const { modelKey, attemptIndex } = selectedNode
    const parsed = parseModelKey(modelKey)
    const matched = flow.results.find((item) => {
      if (item.attemptIndex !== attemptIndex) return false
      return buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId,
        rawId: item.rawId,
      }) === modelKey
    })
    if (matched) return { ...matched, modelKey }

    const attempts = flow.nodeStates.get(modelKey) || []
    const attempt = attempts.find((item) => item.attemptIndex === attemptIndex)
    if (!attempt) return null
    const modelId = parsed?.type === 'global' ? parsed.modelId : parsed?.rawId || modelKey
    return {
      isLive: true,
      modelKey,
      modelId,
      modelLabel: attempt.modelLabel,
      attemptIndex,
      output: attempt.output || '',
      reasoning: attempt.reasoning || '',
      durationMs: attempt.durationMs ?? null,
      error: attempt.error ?? null,
      status: attempt.status,
    }
  }, [selectedNode, flow.results, flow.nodeStates, parseModelKey])

  const fetchRunDetail = useCallback(async (runId: number, options?: { silent?: boolean }) => {
    try {
      const res = await getBattleRun(runId)
      if (!res?.success || !res.data) {
        if (!options?.silent) {
          toast({ title: res?.error || '加载乱斗详情失败', variant: 'destructive' })
        }
        return null
      }
      const detail = res.data as BattleRunDetail
      applyRunDetail(detail)
      return detail
    } catch (error: any) {
      if (!options?.silent) {
        toast({ title: error?.message || '加载乱斗详情失败', variant: 'destructive' })
      }
      return null
    }
  }, [applyRunDetail, toast])

  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    if (typeof window === 'undefined') return
    const storedActive = window.sessionStorage.getItem(RUN_STORAGE_KEY)
    const storedViewed = window.sessionStorage.getItem(LAST_VIEWED_RUN_KEY)
    const stored = storedActive || storedViewed
    if (!stored) return
    const runId = Number.parseInt(stored, 10)
    if (!Number.isFinite(runId)) {
      window.sessionStorage.removeItem(RUN_STORAGE_KEY)
      window.sessionStorage.removeItem(LAST_VIEWED_RUN_KEY)
      return
    }
    void fetchRunDetail(runId, { silent: true })
  }, [fetchRunDetail])

  useEffect(() => {
    if (!restoredRef.current || typeof window === 'undefined') return
    if (flow.currentRunId && flow.isRunning) {
      window.sessionStorage.setItem(RUN_STORAGE_KEY, String(flow.currentRunId))
    } else {
      window.sessionStorage.removeItem(RUN_STORAGE_KEY)
    }
  }, [flow.currentRunId, flow.isRunning])

  useEffect(() => {
    if (!flow.currentRunId || !flow.isRunning || flow.isStreaming) return
    let stopped = false
    const runId = flow.currentRunId
    const poll = async () => {
      if (stopped) return
      const detail = await fetchRunDetail(runId, { silent: true })
      if (!detail || stopped) return
      if (detail.status === 'completed' || detail.status === 'error' || detail.status === 'cancelled') {
        refreshHistory()
      }
    }
    void poll()
    const timer = window.setInterval(poll, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [flow.currentRunId, flow.isRunning, flow.isStreaming, fetchRunDetail, refreshHistory])

  // Load existing run
  const handleLoadRun = async (runId: number) => {
    const detail = await fetchRunDetail(runId)
    if (!detail) return
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(LAST_VIEWED_RUN_KEY, String(runId))
    }
    setShareLink(null)
    setSelectedNode(null)
    setHistoryOpen(false)
  }

  // Share result
  const handleShare = async () => {
    if (!flow.currentRunId) return
    try {
      const res = await createBattleShare(flow.currentRunId)
      if (!res?.success || !res.data) {
        toast({ title: '生成分享链接失败', variant: 'destructive' })
        return
      }
      const token = res.data.token
      const base = typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${base}/share/battle/${token}`
      setShareLink(link)
      toast({ title: '分享链接已生成' })
    } catch (error: any) {
      toast({ title: error?.message || '生成分享链接失败', variant: 'destructive' })
    }
  }

  // Delete run
  const handleDeleteRun = async (runId: number) => {
    try {
      const res = await deleteBattleRun(runId)
      if (!res?.success) {
        toast({ title: res?.error || '删除失败', variant: 'destructive' })
        return
      }
      refreshHistory()
      toast({ title: '已删除' })
    } catch (error: any) {
      toast({ title: error?.message || '删除失败', variant: 'destructive' })
    }
  }

  // Start battle
  const handleStartBattle = async () => {
    setShareLink(null)
    setSelectedNode(null)
    const result = await flow.startBattle(models)
    if (!result.success && result.error) {
      toast({ title: result.error, variant: 'destructive' })
    } else {
      refreshHistory()
    }
  }

  const handleNewBattle = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(RUN_STORAGE_KEY)
      window.sessionStorage.removeItem(LAST_VIEWED_RUN_KEY)
    }
    setSelectedNode(null)
    flow.resetBattle()
  }, [flow.resetBattle])

  const canCancelAttempt = Boolean(
    flow.isRunning &&
      selectedDetail &&
      selectedDetail.isLive &&
      (selectedDetail.status === 'pending' || selectedDetail.status === 'running' || selectedDetail.status === 'judging'),
  )

  const canRetryAttempt = Boolean(flow.isRunning && selectedDetail && selectedDetail.error)

  // 允许所有非 live 且无模型执行错误的结果重新裁决
  // 即使裁判已成功，也支持用户对不准确的裁决进行重试
  const canRetryJudge = Boolean(
    selectedDetail &&
      !selectedDetail.isLive &&
      !selectedDetail.error,
  )

  const handleCancelAttempt = useCallback(async (detail: BattleAttemptDetail) => {
    const result = await flow.cancelAttempt({
      modelKey: detail.modelKey,
      attemptIndex: detail.attemptIndex,
    })
    if (!result.success) {
      toast({ title: result.error || '取消失败', variant: 'destructive' })
    }
  }, [flow.cancelAttempt, toast])

  const handleRetryAttempt = useCallback(async (detail: BattleAttemptDetail) => {
    const result = await flow.retryAttempt({
      modelKey: detail.modelKey,
      attemptIndex: detail.attemptIndex,
    })
    if (!result.success) {
      toast({ title: result.error || '重试失败', variant: 'destructive' })
    }
  }, [flow.retryAttempt, toast])

  const handleRetryJudge = useCallback(async (detail: BattleAttemptDetail) => {
    if ((detail as any).isLive) return
    const resultId = (detail as any).id as number | undefined
    const runId = (detail as any).battleRunId as number | undefined
    if (!resultId) {
      toast({ title: '缺少结果 ID，无法重试裁判', variant: 'destructive' })
      return
    }
    setRetryingJudgeResultId(resultId)
    try {
      const res = await retryBattleJudgeResult(resultId)
      if (!res?.success) {
        toast({ title: res?.error || '重试裁判失败', variant: 'destructive' })
        return
      }
      toast({ title: '已触发重试裁判' })
      const nextRunId = runId || flow.currentRunId
      if (nextRunId) {
        await fetchRunDetail(nextRunId, { silent: true })
      }
    } finally {
      setRetryingJudgeResultId(null)
    }
  }, [fetchRunDetail, flow.currentRunId, toast])

  const handleRetryFailedJudges = useCallback(async () => {
    const runId = flow.currentRunId
    if (!runId) {
      toast({ title: '缺少 runId，无法重试裁判', variant: 'destructive' })
      return
    }
    setRetryingJudgeRun(true)
    try {
      const res = await retryBattleJudgeRun(runId)
      if (!res?.success) {
        toast({ title: res?.error || '批量重试裁判失败', variant: 'destructive' })
        return
      }
      toast({ title: '已触发批量重试裁判' })
      await fetchRunDetail(runId, { silent: true })
    } finally {
      setRetryingJudgeRun(false)
    }
  }, [fetchRunDetail, flow.currentRunId, toast])

  // Handle step navigation
  const handleStepClick = (step: BattleStep) => {
    if (flow.isRunning) return
    flow.goToStep(step)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-4 md:px-6 py-6 space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              <h1 className="text-2xl font-semibold tracking-tight">模型大乱斗</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              同题多模型对战，使用裁判模型评估一致性与准确率，并支持 pass@k 统计
            </p>
          </div>

          {/* History Button */}
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="gap-2 self-start">
                <History className="h-4 w-4" />
                历史记录
              </Button>
            </SheetTrigger>
            <SheetContent dialogTitle="历史记录" className="w-full sm:max-w-md p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold">历史记录</h2>
                <p className="text-sm text-muted-foreground">最近 20 条乱斗记录</p>
              </div>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshHistory}
                  disabled={historyLoading}
                  className="mb-4"
                >
                  刷新
                </Button>
                <ScrollArea className="h-[calc(100vh-200px)]">
                  {history.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      暂无历史记录
                    </div>
                  ) : (
                    <div className="space-y-3 pr-4">
                      {history.map((run) => (
                        <Card key={run.id} className="hover:border-primary/50 transition-colors">
                          <CardContent className="pt-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="space-y-1 flex-1 min-w-0">
                                <div className="text-sm font-medium line-clamp-2">{run.title}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatDate(run.createdAt)}
                                </div>
                              </div>
                              <Badge
                                variant={
                                  run.status === 'completed'
                                    ? 'default'
                                    : run.status === 'error'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                              >
                                {run.status === 'completed'
                                  ? '完成'
                                  : run.status === 'error'
                                    ? '错误'
                                    : run.status === 'cancelled'
                                      ? '已取消'
                                      : run.status}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleLoadRun(run.id)}
                                className="gap-1"
                              >
                                <Eye className="h-3 w-3" />
                                查看
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDeleteRun(run.id)}
                                className="gap-1 text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-3 w-3" />
                                删除
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Stepper */}
        <div className="pb-8">
          <FlowStepper
            currentStep={flow.step}
            onStepClick={handleStepClick}
            isRunning={flow.isRunning}
          />
        </div>

        {/* Dynamic Content based on Step */}
        <div className="min-h-[400px]">
          {flow.step === 'config' && (
            <ConfigStep
              selectedModels={flow.selectedModels}
              judgeConfig={flow.judgeConfig}
              onAddModel={flow.addModel}
              onRemoveModel={flow.removeModel}
              onUpdateModelConfig={flow.updateModelConfig}
              onJudgeConfigChange={flow.setJudgeConfig}
              onNext={() => flow.goToStep('prompt')}
              canProceed={flow.canProceedToPrompt}
            />
          )}

          {flow.step === 'prompt' && (
            <PromptStep
              prompt={flow.prompt}
              expectedAnswer={flow.expectedAnswer}
              selectedModels={flow.selectedModels}
              judgeConfig={flow.judgeConfig}
              onPromptChange={flow.setPrompt}
              onExpectedAnswerChange={flow.setExpectedAnswer}
              onBack={() => flow.goToStep('config')}
              onStart={handleStartBattle}
              canStart={flow.canStartBattle}
              isRunning={flow.isRunning}
            />
          )}

          {flow.step === 'execution' && (
            <ExecutionStep
              prompt={flow.prompt}
              expectedAnswer={flow.expectedAnswer}
              judgeConfig={flow.judgeConfig}
              nodeStates={flow.nodeStates}
              selectedNodeKey={selectedNodeKey || undefined}
              isRunning={flow.isRunning}
              error={flow.error}
              onCancel={flow.cancelBattle}
              onNodeClick={handleNodeClick}
            />
          )}

          {flow.step === 'result' && (
            <ResultStep
              prompt={flow.prompt}
              expectedAnswer={flow.expectedAnswer}
              summary={flow.summary}
              groupedResults={flow.groupedResults}
              statsMap={flow.statsMap}
              fallbackConfig={{
                passK: flow.judgeConfig.passK,
                runsPerModel: flow.judgeConfig.runsPerModel,
                judgeThreshold: flow.judgeConfig.threshold,
              }}
              judgeInfo={flow.currentRunId && flow.judgeConfig.model ? {
                modelId: flow.judgeConfig.model.id,
                connectionId: flow.judgeConfig.model.connectionId ?? null,
                rawId: flow.judgeConfig.model.rawId ?? null,
                threshold: flow.judgeConfig.threshold,
              } : undefined}
              currentRunId={flow.currentRunId}
              status={flow.runStatus}
              onShare={handleShare}
              onNewBattle={handleNewBattle}
              onSelectResult={handleSelectResult}
              onRetryFailedJudges={handleRetryFailedJudges}
              retryingJudgeAll={retryingJudgeRun}
              onRejudgeComplete={() => {
                if (flow.currentRunId) {
                  fetchRunDetail(flow.currentRunId, { silent: true })
                  setShareLink(null)
                }
              }}
              shareLink={shareLink}
            />
          )}
        </div>
      </div>

      <DetailDrawer
        open={selectedDetail !== null}
        onOpenChange={(open) => !open && setSelectedNode(null)}
        detail={selectedDetail}
        isRunning={flow.isRunning}
        canCancelAttempt={canCancelAttempt}
        canRetryAttempt={canRetryAttempt}
        canRetryJudge={canRetryJudge}
        onCancelAttempt={handleCancelAttempt}
        onRetryAttempt={handleRetryAttempt}
        onRetryJudge={handleRetryJudge}
        retryingJudgeId={retryingJudgeResultId}
      />
    </div>
  )
}
