'use client'

import { useEffect, useState, useCallback } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/use-toast'
import { formatDate } from '@/lib/utils'
import { useModelsStore } from '@/store/models-store'
import { History, Trash2, Share2, Eye, Trophy } from 'lucide-react'
import type { BattleRunDetail, BattleRunSummary } from '@/types'
import { createBattleShare, deleteBattleRun, getBattleRun, listBattleRuns } from './api'
import { FlowStepper } from './components/FlowStepper'
import { ConfigStep } from './components/ConfigStep'
import { PromptStep } from './components/PromptStep'
import { ExecutionStep } from './components/ExecutionStep'
import { ResultStep } from './components/ResultStep'
import { useBattleFlow, type BattleStep } from './hooks/useBattleFlow'
import './battle.css'

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

  // Load existing run
  const handleLoadRun = async (runId: number) => {
    try {
      const res = await getBattleRun(runId)
      if (!res?.success || !res.data) {
        toast({ title: '加载乱斗详情失败', variant: 'destructive' })
        return
      }
      const detail = res.data as BattleRunDetail
      flow.loadRun({
        id: detail.id,
        prompt: detail.prompt,
        expectedAnswer: detail.expectedAnswer,
        judgeThreshold: detail.judgeThreshold ?? 0.8,
        runsPerModel: detail.runsPerModel ?? 1,
        passK: detail.passK ?? 1,
        summary: detail.summary,
        results: detail.results || [],
      })
      setHistoryOpen(false)
    } catch (error: any) {
      toast({ title: error?.message || '加载乱斗详情失败', variant: 'destructive' })
    }
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
    const result = await flow.startBattle(models)
    if (!result.success && result.error) {
      toast({ title: result.error, variant: 'destructive' })
    } else {
      refreshHistory()
    }
  }

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
            <SheetContent className="w-full sm:max-w-md p-6">
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
                                {run.status === 'completed' ? '完成' : run.status === 'error' ? '错误' : run.status}
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
              isRunning={flow.isRunning}
              error={flow.error}
              onCancel={flow.cancelBattle}
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
              currentRunId={flow.currentRunId}
              onShare={handleShare}
              onNewBattle={flow.resetBattle}
              onViewHistory={() => setHistoryOpen(true)}
              shareLink={shareLink}
            />
          )}
        </div>
      </div>
    </div>
  )
}
