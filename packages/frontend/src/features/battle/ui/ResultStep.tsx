'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {Trophy,
    Medal,
    Award,
    Share2,
    RefreshCw,
    Check,
    X,
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    Clock,
    FileText,
    Edit,
} from 'lucide-react'
import type { BattleResult, BattleRunSummary } from '@/types'
import { ModelStatsTable } from './ModelStatsTable'
import { RejudgeDialog } from './RejudgeDialog'

interface ResultStepProps {
    prompt: string
    expectedAnswer: string
    summary: BattleRunSummary['summary'] | null
    groupedResults: Array<{ key: string; label: string; attempts: BattleResult[] }>
    statsMap: Map<string, BattleRunSummary['summary']['modelStats'][number]>
    fallbackConfig?: {
        passK: number
        runsPerModel: number
        judgeThreshold: number
    }
    currentRunId: number | null
    status?: BattleRunSummary['status'] | null
    onShare: () => void
    onNewBattle: () => void
    onSelectResult: (result: BattleResult) => void
    onRetryFailedJudges?: () => void
    onRejudgeComplete?: () => void
    shareLink?: string | null
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)

const getRankDisplay = (rank: number) => {
    switch (rank) {
        case 1:
            return { icon: <Trophy className="h-6 w-6 text-yellow-500" />, bg: 'bg-yellow-500/10 border-yellow-500/20' }
        case 2:
            return { icon: <Medal className="h-6 w-6 text-gray-400" />, bg: 'bg-gray-400/10 border-gray-400/20' }
        case 3:
            return { icon: <Award className="h-6 w-6 text-amber-600" />, bg: 'bg-amber-600/10 border-amber-600/20' }
        default:
            return { icon: <span className="text-base font-semibold text-muted-foreground">#{rank}</span>, bg: 'bg-muted/30 border-border/50' }
    }
}

// 截取输出内容摘要
const getOutputSummary = (output: string | null | undefined, maxLen = 100): string => {
    if (!output) return ''
    const cleaned = output.replace(/\n+/g, ' ').trim()
    if (cleaned.length <= maxLen) return cleaned
    return cleaned.slice(0, maxLen) + '...'
}

export function ResultStep({
    prompt,
    expectedAnswer,
    summary,
    groupedResults,
    statsMap,
    fallbackConfig,
    currentRunId,
    status,
    onShare,
    onNewBattle,
    onSelectResult,
    onRetryFailedJudges,
    onRejudgeComplete,
    shareLink,
}: ResultStepProps) {
    const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
    const [showQuestion, setShowQuestion] = useState(false)
    const [rejudgeOpen, setRejudgeOpen] = useState(false)

    const resolvedPassK = useMemo(() => {
        if (isFiniteNumber(summary?.passK)) return summary.passK
        if (isFiniteNumber(fallbackConfig?.passK)) return fallbackConfig.passK
        return 1
    }, [summary?.passK, fallbackConfig?.passK])

    const resolvedRunsPerModel = useMemo(() => {
        if (isFiniteNumber(summary?.runsPerModel)) return summary.runsPerModel
        if (isFiniteNumber(fallbackConfig?.runsPerModel)) return fallbackConfig.runsPerModel
        const maxAttempts = groupedResults.reduce((max, group) => Math.max(max, group.attempts.length), 0)
        return Math.max(1, maxAttempts)
    }, [summary?.runsPerModel, fallbackConfig?.runsPerModel, groupedResults])

    const resolvedJudgeThreshold = useMemo(() => {
        if (isFiniteNumber(summary?.judgeThreshold)) return summary.judgeThreshold
        if (isFiniteNumber(fallbackConfig?.judgeThreshold)) return fallbackConfig.judgeThreshold
        return 0.8
    }, [summary?.judgeThreshold, fallbackConfig?.judgeThreshold])

    const computedStatsMap = useMemo(() => {
        const map = new Map<string, { passAtK: boolean; passCount: number; accuracy: number; judgedCount: number; totalAttempts: number }>()
        groupedResults.forEach((group) => {
            const totalAttempts = group.attempts.length
            const judgedAttempts = group.attempts.filter((attempt) => {
                if (attempt.error) return false
                const status = attempt.judgeStatus
                if (status === 'error') return false
                return attempt.judgePass != null
            })
            const judgedCount = judgedAttempts.length
            const passCount = judgedAttempts.filter((attempt) => attempt.judgePass === true).length
            // 使用 totalAttempts 作为分母计算准确率，这样错误的尝试也会被计入
            // 确保统计的公平性：无论是模型报错还是裁判失败，都应该算作未通过
            const accuracy = totalAttempts > 0 ? passCount / totalAttempts : 0
            map.set(group.key, {
                passAtK: passCount >= resolvedPassK,
                passCount,
                accuracy,
                judgedCount,
                totalAttempts,
            })
        })
        return map
    }, [groupedResults, resolvedPassK])

    const mergedStatsMap = useMemo(() => {
        const map = new Map<string, { passAtK: boolean; passCount: number; accuracy: number; judgedCount: number; totalAttempts: number }>()
        computedStatsMap.forEach((computed, key) => {
            map.set(key, computed)
        })
        statsMap.forEach((stat, key) => {
            if (map.has(key)) return
            const passAtK = typeof stat.passAtK === 'boolean' ? stat.passAtK : false
            const passCount = isFiniteNumber(stat.passCount) ? stat.passCount : 0
            const accuracy = isFiniteNumber(stat.accuracy) ? stat.accuracy : 0
            const judgedCount = isFiniteNumber((stat as any).judgedCount) ? Math.max(0, Math.floor((stat as any).judgedCount)) : 0
            const totalAttempts = isFiniteNumber((stat as any).totalAttempts) ? Math.max(0, Math.floor((stat as any).totalAttempts)) : 0
            map.set(key, { passAtK, passCount, accuracy, judgedCount, totalAttempts })
        })
        return map
    }, [computedStatsMap, statsMap])

    const retryableJudgeCount = useMemo(() => {
        let count = 0
        for (const group of groupedResults) {
            for (const attempt of group.attempts) {
                if (attempt.error) continue
                const status = attempt.judgeStatus
                if (status === 'success' && attempt.judgePass != null) continue
                count += 1
            }
        }
        return count
    }, [groupedResults])

    const displaySummary = useMemo(() => {
        if (!summary && groupedResults.length === 0) return null
        const hasResults = groupedResults.length > 0
        const totalModels = hasResults
            ? groupedResults.length
            : isFiniteNumber(summary?.totalModels) ? summary.totalModels: mergedStatsMap.size
        const computedPassModelCount = Array.from(mergedStatsMap.values()).filter((stat) => stat.passAtK).length
        const passModelCount = hasResults
            ? computedPassModelCount
            : isFiniteNumber(summary?.passModelCount)? summary.passModelCount
                : computedPassModelCount
        const accuracy = hasResults
            ? totalModels > 0
                ? passModelCount / totalModels
                : 0
            : isFiniteNumber(summary?.accuracy)
                ? summary.accuracy
                : totalModels > 0? passModelCount / totalModels
                    : 0
        return {
            totalModels,
            runsPerModel: resolvedRunsPerModel,
            passK: resolvedPassK,
            judgeThreshold: resolvedJudgeThreshold,
            passModelCount,
            accuracy,
        }
    }, [
        summary,
        groupedResults.length,
        mergedStatsMap,
        resolvedRunsPerModel,
        resolvedPassK,
        resolvedJudgeThreshold,
    ])

    const rankedModels = useMemo(() => {
        return [...groupedResults].sort((a, b) => {
            const statA = mergedStatsMap.get(a.key)
            const statB = mergedStatsMap.get(b.key)

            if (statA?.passAtK !== statB?.passAtK) {
                return statA?.passAtK ? -1 : 1
            }

            return (statB?.accuracy ?? 0) - (statA?.accuracy ?? 0)
        })
    }, [groupedResults, mergedStatsMap])

    // Calculate average response time
    const avgResponseTime = useMemo(() => {
        let total = 0
        let count = 0
        groupedResults.forEach((group) => {
            group.attempts.forEach((attempt) => {
                if (attempt.durationMs != null && !attempt.error) {
                    total += attempt.durationMs
                    count++
                }
            })
        })
        return count > 0 ? total / count : 0
    }, [groupedResults])

    const toggleExpand = (key: string) => {
        setExpandedModels((prev) => {
            const next = new Set(prev)
            if (next.has(key)) {
                next.delete(key)
            } else {
                next.add(key)
            }
            return next
        })
    }

    const isError = status === 'error'
    const isCancelled = status === 'cancelled'

    return (
        <div className="space-y-6 w-full">
            {/* Header */}
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    {/* 核心统计 - 单行摘要 */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                            {isCancelled ? (
                                <X className="h-5 w-5 text-muted-foreground" />
                            ) : isError ? (
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                            ) : (
                                <Trophy className="h-5 w-5 text-yellow-500" />
                            )}
                            <span className="font-semibold text-foreground">
                                {isCancelled ? '对战已取消' : isError ? '对战失败' : '对战完成'}
                            </span>
                        </div>
                        {displaySummary && (
                            <>
                                <span className="text-muted-foreground/40">·</span>
                                <span className="font-semibold text-foreground">
                                    {displaySummary.passModelCount}/{displaySummary.totalModels}模型通过
                                </span>
                                <span className="text-muted-foreground/40">·</span>
                                <span>准确率 {(displaySummary.accuracy * 100).toFixed(0)}%</span>
                                {avgResponseTime > 0 && (
                                    <>
                                        <span className="text-muted-foreground/40">·</span>
                                        <span className="flex items-center gap-1.5">
                                            <Clock className="h-4 w-4" />
                                            平均 {(avgResponseTime / 1000).toFixed(1)}s
                                        </span>
                                    </>
                                )}
                                <span className="text-muted-foreground/40">·</span>
                                <span>阈值 {displaySummary.judgeThreshold.toFixed(2)}</span>
                            </>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {currentRunId && retryableJudgeCount > 0 && onRetryFailedJudges && (
                            <Button variant="outline" size="default" onClick={onRetryFailedJudges}>
                                <RefreshCw className="h-4 w-4 mr-2" />
                                重试裁判（{retryableJudgeCount}）
                            </Button>
                        )}
                        {currentRunId && (
                            <Button variant="outline" size="default" onClick={onShare}>
                                <Share2 className="h-4 w-4 mr-2" />
                                分享
                            </Button>
                        )}
                        <Button size="default" onClick={onNewBattle}>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            新对战
                        </Button>
                    </div>
                </div>
            </div>

            {/* Share Link */}
            {shareLink && (
                <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
                    分享链接：<a className="text-primary hover:underline ml-2" href={shareLink} target="_blank" rel="noreferrer">
                        {shareLink}</a>
                </div>
            )}

            {/* 题目预览 - 可折叠 */}
            <Collapsible open={showQuestion} onOpenChange={setShowQuestion}>
                <CollapsibleTrigger asChild>
                    <button className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1">
                        {showQuestion ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<FileText className="h-4 w-4" />
                        查看题目与期望答案
                    </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-3">
                    <div className="rounded-lg bg-muted/30 p-4 space-y-3">
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">题目</div>
                            <div className="text-sm text-foreground leading-relaxed">{prompt}</div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <div className="text-xs font-medium text-muted-foreground">期望答案</div>
                                {currentRunId && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setRejudgeOpen(true)}
                                        className="h-6 text-xs gap-1 px-2"
                                    >
                                        <Edit className="h-3 w-3" />
                                        修正答案
                                    </Button>
                                )}
                            </div>
                            <div className="text-sm text-foreground leading-relaxed">{expectedAnswer}</div>
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* 修正答案对话框 */}
            {currentRunId && (
                <RejudgeDialog
                    open={rejudgeOpen}
                    onOpenChange={setRejudgeOpen}
                    currentAnswer={expectedAnswer}
                    runId={currentRunId}
                    onComplete={() => onRejudgeComplete?.()}
                />
            )}

            {/* 模型统计总表 */}
            <ModelStatsTable
                groupedResults={rankedModels}
                statsMap={mergedStatsMap}
                className="mb-4"
            />

            {/* 模型卡片列表 */}
            <div className="space-y-3">
                {rankedModels.map((group, index) => {
                    const stat = mergedStatsMap.get(group.key)
                    const isExpanded = expandedModels.has(group.key)
                    const rank = getRankDisplay(index + 1)
                    const bestAttempt = group.attempts.find(a => a.judgePass) || group.attempts[0]
                    const outputSummary = getOutputSummary(bestAttempt?.output)

                    return (
                        <div
                            key={group.key}
                            className={cn(
                                "rounded-xl border transition-all",
                                rank.bg,
                                isExpanded && "shadow-sm"
                            )}
                        >
                            {/* 模型主行*/}
                            <button
                                className="w-full flex items-center gap-4 p-4 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
                                onClick={() => toggleExpand(group.key)}
                            >
                                {/* 排名 */}
                                <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-background/80 border border-border/50">
                                    {rank.icon}
                                </div>

                                {/* 模型信息 */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-semibold text-sm truncate">{group.label}</span>
                                        <Badge
                                            variant={stat?.passAtK ? 'default' : 'secondary'}
                                            className="flex-shrink-0 text-xs"
                                        >
                                            {stat?.passAtK ? (
                                                <><Check className="h-3 w-3 mr-0.5" />通过</>
                                            ) : (
                                                <><X className="h-3 w-3 mr-0.5" />未通过</>
                                            )}</Badge>
                                    </div>
                                    {outputSummary && (<p className="text-xs text-muted-foreground line-clamp-1">
                                            {outputSummary}</p>
                                    )}
                                </div>

                                {/* 准确率 */}<div className="flex-shrink-0 text-right px-2"><div className="text-base font-bold">
                                        {stat ? `${(stat.accuracy * 100).toFixed(0)}%` : '--'}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {stat?.passCount ?? 0}/{stat?.totalAttempts ?? group.attempts.length} 通过
                                    </div>
                                </div>

                                {/* 展开指示 */}
                                <div className="flex-shrink-0">
                                    {isExpanded ? (
                                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                                    ) : (
                                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                    )}
                                </div>
                            </button>

                            {/* 展开内容 - 各次尝试 */}
                            {isExpanded && (
                                <div className="px-4 pb-4 space-y-2"><div className="border-t border-border/50 mb-3" />
                                    {group.attempts.map((attempt) => (
                                        <div
                                            key={`${group.key}-${attempt.attemptIndex}`}
                                            className="flex items-center justify-between gap-4 py-2 px-4 rounded-lg bg-background/60 cursor-pointer hover:bg-background transition-colors"
                                            onClick={() => onSelectResult(attempt)}
                                        >
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm text-muted-foreground min-w-[4.5rem]">
                                                    第 {attempt.attemptIndex} 次
                                                </span>
                                                {attempt.error ? (
                                                    <Badge variant="destructive">错误</Badge>
                                                ) : attempt.judgeStatus === 'running' ? (
                                                    <Badge variant="secondary">评测中</Badge>
                                                ) : attempt.judgeStatus === 'error' ? (
                                                    <Badge variant="secondary">裁判失败</Badge>
                                                ) : attempt.judgePass != null ? (<Badge variant={attempt.judgePass ? 'outline' : 'secondary'}>
                                                        {attempt.judgePass ? '✓' : '✗'} {attempt.judgeScore?.toFixed(2) ?? '--'}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="secondary">--</Badge>
                                                )}
                                            </div><div className="text-sm text-muted-foreground">
                                                {attempt.durationMs != null ? `${(attempt.durationMs / 1000).toFixed(1)}s` : '--'}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
