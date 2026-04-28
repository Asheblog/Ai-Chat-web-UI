'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Clock, Loader2, CheckCircle, XCircle, AlertTriangle, Share2 } from 'lucide-react'
import { FlowGraph } from './FlowGraph'
import { BattleContentBlock } from './BattleContentBlock'
import type { JudgeConfig, NodeState } from '../hooks/useBattleFlow'

interface ExecutionStepProps {
    prompt: string
    expectedAnswer: string
    promptImages: string[]
    expectedAnswerImages: string[]
    judgeConfig: JudgeConfig
    nodeStates: Map<string, NodeState[]>
    selectedNodeKey?: string
    isRunning: boolean
    error: string | null
    onCancel: () => void
    onNodeClick?: (modelKey: string, attemptIndex: number) => void
    onShare?: () => void
    shareLink?: string | null
}

export function ExecutionStep({
    prompt,
    expectedAnswer,
    promptImages,
    expectedAnswerImages,
    judgeConfig,
    nodeStates,
    selectedNodeKey,
    isRunning,
    error,
    onCancel,
    onNodeClick,
    onShare,
    shareLink,
}: ExecutionStepProps) {
    // Calculate statistics
    const stats = useMemo(() => {
        let total = 0
        let running = 0
        let success = 0
        let failed = 0
        let pending = 0
        let totalDurationMs = 0
        let completedCount = 0

        nodeStates.forEach((attempts) => {
            for (const attempt of attempts) {
                total++
                switch (attempt.status) {
                    case 'pending':
                        pending++
                        break
                    case 'running':
                    case 'judging':
                        running++
                        break
                    case 'success':
                        success++
                        if (attempt.durationMs != null) {
                            totalDurationMs += attempt.durationMs
                            completedCount++
                        }
                        break
                    case 'error':
                        failed++
                        if (attempt.durationMs != null) {
                            totalDurationMs += attempt.durationMs
                            completedCount++
                        }
                        break
                }
            }
        })

        const avgDuration = completedCount > 0 ? totalDurationMs / completedCount : 0
        const completed = success + failed

        return { total, running, success, failed, pending, completed, avgDuration }
    }, [nodeStates])

    const progressPercentage = stats.total > 0 ? (stats.completed / stats.total) * 100 : 0

    return (
        <div className="w-full space-y-4">
            {/* Header with Cancel */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        {isRunning ? (
                            <>
                                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                对战进行中...
                            </>
                        ) : error ? (
                            <>
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                                执行出错
                            </>
                        ) : (
                            <>
                                <CheckCircle className="h-5 w-5 text-green-500" />
                                执行完成
                            </>
                        )}
                    </h2>
                </div>
                <div className="flex items-center gap-2">
                    {onShare && (
                        <Button variant="outline" onClick={onShare} className="gap-2">
                            <Share2 className="h-4 w-4" />
                            分享
                        </Button>
                    )}
                    {isRunning && (
                        <Button variant="outline" onClick={onCancel} className="gap-2">
                            <X className="h-4 w-4" />
                            取消
                        </Button>
                    )}
                </div>
            </div>

            {/* Error Message */}
            {error && (
                <Card className="border-destructive bg-destructive/10">
                    <CardContent className="pt-4">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {shareLink && (
                <Card className="bg-muted/30">
                    <CardContent className="pt-4">
                        <div className="text-sm text-muted-foreground">
                            分享链接：
                            <a className="text-primary hover:underline ml-2" href={shareLink} target="_blank" rel="noreferrer">
                                {shareLink}
                            </a>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Question Preview */}
            <div className="grid gap-4 lg:grid-cols-[0.58fr_0.42fr]">
            <Card className="v2-panel shadow-none">
                <CardContent className="space-y-2 pt-4">
                    <div className="grid gap-4">
                        <BattleContentBlock
                            title="题目"
                            text={prompt}
                            images={promptImages}
                            compact
                        />
                        <BattleContentBlock
                            title="期望答案"
                            text={expectedAnswer}
                            images={expectedAnswerImages}
                            compact
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Flow Graph */}
            <Card className="v2-panel shadow-none">
                <CardHeader className="pb-2">
                    <CardTitle className="text-base">执行流程</CardTitle>
                </CardHeader>
                <CardContent>
                    <FlowGraph
                        judgeLabel={judgeConfig.model?.name || '裁判模型'}
                        nodeStates={nodeStates}
                        selectedNodeKey={selectedNodeKey}
                        onNodeClick={onNodeClick}
                        isRunning={isRunning}
                    />
                </CardContent>
            </Card>
            </div>

            {/* Real-time Statistics */}
            <div className="v2-panel-soft grid gap-3 px-4 py-3 sm:grid-cols-4">
                <div className="flex items-center gap-3 border-r border-slate-200 last:border-r-0">
                    <Loader2 className="h-5 w-5 text-blue-500" />
                    <div><p className="text-xs text-slate-500">进行中</p><p className="text-lg font-semibold text-slate-900">{stats.running}</p></div>
                </div>
                <div className="flex items-center gap-3 border-r border-slate-200 last:border-r-0">
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                    <div><p className="text-xs text-slate-500">通过</p><p className="text-lg font-semibold text-slate-900">{stats.success}</p></div>
                </div>
                <div className="flex items-center gap-3 border-r border-slate-200 last:border-r-0">
                    <XCircle className="h-5 w-5 text-destructive" />
                    <div><p className="text-xs text-slate-500">失败</p><p className="text-lg font-semibold text-slate-900">{stats.failed}</p></div>
                </div>
                <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-500" />
                    <div><p className="text-xs text-slate-500">平均耗时</p><p className="text-lg font-semibold text-slate-900">{stats.avgDuration > 0 ? `${(stats.avgDuration / 1000).toFixed(1)}s` : '--'}</p></div>
                </div>
            </div>

            {/* Overall Progress */}
            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">总体进度</span>
                    <span className="font-medium">
                        {stats.completed}/{stats.total} 完成
                    </span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                    <div
                        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                    />
                </div>
            </div>
        </div>
    )
}
