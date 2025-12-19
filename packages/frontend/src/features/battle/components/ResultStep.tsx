'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Trophy,
    Medal,
    Award,
    Share2,
    RefreshCw,
    History,
    Eye,
    Check,
    X,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import { StatisticsCard } from './StatisticsCard'
import { DetailDrawer } from './DetailDrawer'
import type { BattleResult, BattleRunSummary } from '@/types'

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
    onShare: () => void
    onNewBattle: () => void
    onViewHistory: () => void
    shareLink?: string | null
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)

const getRankIcon = (rank: number) => {
    switch (rank) {
        case 1:
            return <Trophy className="h-5 w-5 text-yellow-500" />
        case 2:
            return <Medal className="h-5 w-5 text-gray-400" />
        case 3:
            return <Award className="h-5 w-5 text-amber-600" />
        default:
            return <span className="text-sm text-muted-foreground">#{rank}</span>
    }
}

export function ResultStep({
    prompt,
    expectedAnswer,
    summary,
    groupedResults,
    statsMap,
    fallbackConfig,
    currentRunId,
    onShare,
    onNewBattle,
    onViewHistory,
    shareLink,
}: ResultStepProps) {
    const [selectedResult, setSelectedResult] = useState<BattleResult | null>(null)
    const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())

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
        const map = new Map<string, { passAtK: boolean; passCount: number; accuracy: number }>()
        groupedResults.forEach((group) => {
            const attempts = group.attempts.length
            const passCount = group.attempts.filter((attempt) => attempt.judgePass === true).length
            const accuracy = attempts > 0 ? passCount / attempts : 0
            map.set(group.key, {
                passAtK: passCount >= resolvedPassK,
                passCount,
                accuracy,
            })
        })
        return map
    }, [groupedResults, resolvedPassK])

    const mergedStatsMap = useMemo(() => {
        const map = new Map<string, { passAtK: boolean; passCount: number; accuracy: number }>()
        for (const [key, computed] of computedStatsMap) {
            map.set(key, computed)
        }
        for (const [key, stat] of statsMap) {
            if (map.has(key)) continue
            const passAtK = typeof stat.passAtK === 'boolean' ? stat.passAtK : false
            const passCount = isFiniteNumber(stat.passCount) ? stat.passCount : 0
            const accuracy = isFiniteNumber(stat.accuracy) ? stat.accuracy : 0
            map.set(key, { passAtK, passCount, accuracy })
        }
        return map
    }, [computedStatsMap, statsMap])

    const displaySummary = useMemo(() => {
        if (!summary && groupedResults.length === 0) return null
        const hasResults = groupedResults.length > 0
        const totalModels = hasResults
            ? groupedResults.length
            : isFiniteNumber(summary?.totalModels)
                ? summary.totalModels
                : mergedStatsMap.size
        const computedPassModelCount = Array.from(mergedStatsMap.values()).filter((stat) => stat.passAtK).length
        const passModelCount = hasResults
            ? computedPassModelCount
            : isFiniteNumber(summary?.passModelCount)
                ? summary.passModelCount
                : computedPassModelCount
        const accuracy = hasResults
            ? totalModels > 0
                ? passModelCount / totalModels
                : 0
            : isFiniteNumber(summary?.accuracy)
                ? summary.accuracy
                : totalModels > 0
                    ? passModelCount / totalModels
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

    const passRate = displaySummary ? Math.min(1, Math.max(0, displaySummary.accuracy)) : 0

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            {/* Header with Actions */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold flex items-center gap-2">
                        <Trophy className="h-5 w-5 text-yellow-500" />
                        对战完成!
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        查看各模型表现和裁判评分
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={onViewHistory} className="gap-2">
                        <History className="h-4 w-4" />
                        历史
                    </Button>
                    {currentRunId && (
                        <Button variant="outline" size="sm" onClick={onShare} className="gap-2">
                            <Share2 className="h-4 w-4" />
                            分享
                        </Button>
                    )}
                    <Button onClick={onNewBattle} className="gap-2">
                        <RefreshCw className="h-4 w-4" />
                        新对战
                    </Button>
                </div>
            </div>

            {/* Share Link */}
            {shareLink && (
                <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-3 text-sm">
                    分享链接：
                    <a className="text-primary hover:underline ml-2" href={shareLink} target="_blank" rel="noreferrer">
                        {shareLink}
                    </a>
                </div>
            )}

            {/* Statistics Cards */}
            {displaySummary && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatisticsCard
                        label="Pass@k 通过率"
                        value={`${(passRate * 100).toFixed(0)}%`}
                        subValue={`${displaySummary.passModelCount}/${displaySummary.totalModels} 模型通过`}
                        icon="rate"
                        variant={passRate >= 0.8 ? 'success' : passRate >= 0.5 ? 'warning' : 'error'}
                        progress={passRate * 100}
                    />
                    <StatisticsCard
                        label="通过模型数"
                        value={`${displaySummary.passModelCount}`}
                        subValue={`共 ${displaySummary.totalModels} 个参赛`}
                        icon="models"
                        variant="default"
                    />
                    <StatisticsCard
                        label="平均响应时间"
                        value={avgResponseTime > 0 ? `${(avgResponseTime / 1000).toFixed(1)}s` : '--'}
                        icon="time"
                        variant="default"
                    />
                    <StatisticsCard
                        label="裁判阈值"
                        value={displaySummary.judgeThreshold.toFixed(2)}
                        subValue={`pass@${displaySummary.passK} / ${displaySummary.runsPerModel} 次运行`}
                        icon="target"
                        variant="default"
                    />
                </div>
            )}

            {/* Question Preview */}
            <Card className="bg-muted/30">
                <CardContent className="pt-4">
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

            {/* Model Leaderboard */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">模型排行榜</CardTitle>
                    <CardDescription>按照 pass@k 和准确率排序</CardDescription>
                </CardHeader>
                <CardContent>
                    <ScrollArea className="w-full">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[60px]">排名</TableHead>
                                    <TableHead>模型</TableHead>
                                    <TableHead className="text-center">Pass@k</TableHead>
                                    <TableHead className="text-center">准确率</TableHead>
                                    <TableHead className="text-center">通过次数</TableHead>
                                    <TableHead className="w-[80px]">操作</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rankedModels.map((group, index) => {
                                    const stat = mergedStatsMap.get(group.key)
                                    const isExpanded = expandedModels.has(group.key)

                                    return (
                                        <>
                                            <TableRow key={group.key} className="hover:bg-muted/50">
                                                <TableCell>
                                                    <div className="flex items-center justify-center">
                                                        {getRankIcon(index + 1)}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="font-medium">{group.label}</TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant={stat?.passAtK ? 'default' : 'secondary'}>
                                                        {stat?.passAtK ? (
                                                            <>
                                                                <Check className="h-3 w-3 mr-1" />
                                                                通过
                                                            </>
                                                        ) : (
                                                            <>
                                                                <X className="h-3 w-3 mr-1" />
                                                                未通过
                                                            </>
                                                        )}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {stat ? `${(stat.accuracy * 100).toFixed(0)}%` : '--'}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {stat?.passCount ?? 0}/{group.attempts.length}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => toggleExpand(group.key)}
                                                    >
                                                        {isExpanded ? (
                                                            <ChevronUp className="h-4 w-4" />
                                                        ) : (
                                                            <ChevronDown className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>

                                            {/* Expanded attempts */}
                                            {isExpanded && group.attempts.map((attempt) => (
                                                <TableRow
                                                    key={`${group.key}-${attempt.attemptIndex}`}
                                                    className="bg-muted/30"
                                                >
                                                    <TableCell />
                                                    <TableCell className="pl-8">
                                                        <span className="text-sm text-muted-foreground">
                                                            第 {attempt.attemptIndex} 次尝试
                                                        </span>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Badge
                                                            variant={attempt.judgePass ? 'outline' : 'secondary'}
                                                            className="text-xs"
                                                        >
                                                            {attempt.judgePass ? '✓' : '✗'}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-center text-sm">
                                                        {attempt.judgeScore != null ? attempt.judgeScore.toFixed(2) : '--'}
                                                    </TableCell>
                                                    <TableCell className="text-center text-sm text-muted-foreground">
                                                        {attempt.durationMs != null ? `${(attempt.durationMs / 1000).toFixed(1)}s` : '--'}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => setSelectedResult(attempt)}
                                                        >
                                                            <Eye className="h-4 w-4" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </ScrollArea>
                </CardContent>
            </Card>

            {/* Detail Drawer */}
            <DetailDrawer
                open={selectedResult !== null}
                onOpenChange={(open) => !open && setSelectedResult(null)}
                result={selectedResult}
            />
        </div>
    )
}
