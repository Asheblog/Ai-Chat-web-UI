'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { X, Clock, Loader2, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { FlowGraph } from './FlowGraph'
import type { JudgeConfig, NodeState } from '../hooks/useBattleFlow'

interface ExecutionStepProps {
    prompt: string
    expectedAnswer: string
    judgeConfig: JudgeConfig
    nodeStates: Map<string, NodeState[]>
    selectedNodeKey?: string
    isRunning: boolean
    error: string | null
    onCancel: () => void
    onNodeClick?: (modelKey: string, attemptIndex: number) => void
}

export function ExecutionStep({
    prompt,
    expectedAnswer,
    judgeConfig,
    nodeStates,
    selectedNodeKey,
    isRunning,
    error,
    onCancel,
    onNodeClick,
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
        <div className="space-y-6 w-full">
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
                {isRunning && (
                    <Button variant="outline" onClick={onCancel} className="gap-2">
                        <X className="h-4 w-4" />
                        取消
                    </Button>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <Card className="border-destructive bg-destructive/10">
                    <CardContent className="pt-4">
                        <p className="text-sm text-destructive">{error}</p>
                    </CardContent>
                </Card>
            )}

            {/* Question Preview */}
            <Card className="bg-muted/30">
                <CardContent className="pt-4 space-y-2">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">题目</div>
                            <div className="text-sm line-clamp-3">{prompt}</div>
                        </div>
                        <div>
                            <div className="text-xs text-muted-foreground mb-1">期望答案</div>
                            <div className="text-sm line-clamp-3">{expectedAnswer}</div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Flow Graph */}
            <Card>
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

            {/* Real-time Statistics */}
            <div className="grid gap-4 sm:grid-cols-4">
                <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 text-blue-500" />
                            <span className="text-xs text-muted-foreground">进行中</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-500">{stats.running}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                            <span className="text-xs text-muted-foreground">通过</span>
                        </div>
                        <div className="text-2xl font-bold text-green-500">{stats.success}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-500/10 to-red-600/5">
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                            <XCircle className="h-4 w-4 text-destructive" />
                            <span className="text-xs text-muted-foreground">失败</span>
                        </div>
                        <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5">
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-amber-500" />
                            <span className="text-xs text-muted-foreground">平均耗时</span>
                        </div>
                        <div className="text-2xl font-bold text-amber-500">
                            {stats.avgDuration > 0 ? `${(stats.avgDuration / 1000).toFixed(1)}s` : '--'}
                        </div>
                    </CardContent>
                </Card>
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
