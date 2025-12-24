'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Trophy, Medal, Award, Check, X, Clock, Zap } from 'lucide-react'
interface BattleResultLike {
  modelId: string
  modelLabel?: string | null
  connectionId?: number | null
  rawId?: string | null
  attemptIndex: number
  output: string
  reasoning?: string | null
  usage?: Record<string, any>
  durationMs?: number | null
  error?: string | null
  judgeStatus?: 'unknown' | 'running' | 'success' | 'error' | 'skipped'
  judgeError?: string | null
  judgePass?: boolean | null
  judgeScore?: number | null
  judgeReason?: string | null
  judgeFallbackUsed?: boolean
}

interface ModelStats {
  key: string
  label: string
  passAtK: boolean
  accuracy: number
  passCount: number
  totalAttempts: number
  avgDurationMs: number
  totalInputTokens: number
  totalOutputTokens: number
  avgOutputTokens: number
  attempts: Array<{
    index: number
    durationMs: number | null
    inputTokens: number
    outputTokens: number
    passed: boolean | null
    score: number | null
    error: boolean
  }>
}

interface ModelStatsTableProps {
  groupedResults: Array<{ key: string; label: string; attempts: BattleResultLike[] }>
  statsMap: Map<string, { passAtK: boolean; passCount: number; accuracy: number; judgedCount: number; totalAttempts: number }>
  className?: string
}

const getRankIcon = (rank: number) => {
  switch (rank) {
    case 1:
      return <Trophy className="h-4 w-4 text-yellow-500" />
    case 2:
      return <Medal className="h-4 w-4 text-gray-400" />
    case 3:
      return <Award className="h-4 w-4 text-amber-600" />
    default:
      return <span className="text-xs text-muted-foreground">#{rank}</span>
  }
}

export function ModelStatsTable({ groupedResults, statsMap, className }: ModelStatsTableProps) {
  // 计算每个模型的详细统计数据
  const modelStats = useMemo<ModelStats[]>(() => {
    return groupedResults.map((group) => {
      const stat = statsMap.get(group.key)
      let totalDuration = 0
      let durationCount = 0
      let totalInputTokens = 0
      let totalOutputTokens = 0
      let outputTokenCount = 0

      const attempts = group.attempts.map((attempt) => {
        const usage = attempt.usage || {}
        const inputTokens = usage.prompt_tokens || 0
        const outputTokens = usage.completion_tokens || 0
        totalInputTokens += inputTokens
        totalOutputTokens += outputTokens
        if (outputTokens > 0) {
          outputTokenCount++
        }

        if (attempt.durationMs) {
          totalDuration += attempt.durationMs
          durationCount++
        }

        return {
          index: attempt.attemptIndex,
          durationMs: attempt.durationMs ?? null,
          inputTokens,
          outputTokens,
          passed: attempt.judgePass ?? null,
          score: attempt.judgeScore ?? null,
          error: !!attempt.error,
        }
      })

      return {
        key: group.key,
        label: group.label,
        passAtK: stat?.passAtK ?? false,
        accuracy: stat?.accuracy ?? 0,
        passCount: stat?.passCount ?? 0,
        totalAttempts: attempts.length,
        avgDurationMs: durationCount > 0 ? totalDuration / durationCount : 0,
        totalInputTokens,
        totalOutputTokens,
        avgOutputTokens: outputTokenCount > 0 ? Math.round(totalOutputTokens / outputTokenCount) : 0,
        attempts,
      }
    }).sort((a, b) => {
      // 先按passAtK 排序
      if (a.passAtK !== b.passAtK) return a.passAtK ? -1 : 1
      // 再按准确率排序
      return b.accuracy - a.accuracy
    })
  }, [groupedResults, statsMap])

  if (modelStats.length === 0) return null

  // 获取最大尝试次数
  const maxAttempts = Math.max(...modelStats.map(s => s.attempts.length), 1)

  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="p-4 border-b">
        <h3 className="text-base font-semibold">模型统计总表</h3>
        <p className="text-sm text-muted-foreground">各模型的 Pass@k、耗时、Token 使用等指标</p>
      </div>
      <ScrollArea className="w-full">
        <div className="min-w-[800px]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left py-3 px-4 font-medium sticky left-0 bg-muted/30 z-10 min-w-[140px]">
                  模型
                </th>
                <th className="text-center py-3 px-3 font-medium min-w-[80px]">Pass@k</th>
                <th className="text-center py-3 px-3 font-medium min-w-[70px]">准确率</th>
                <th className="text-center py-3 px-3 font-medium min-w-[80px]"><span className="flex items-center justify-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    平均耗时
                  </span>
                </th>
                <th className="text-center py-3 px-3 font-medium min-w-[90px]">
                  <span className="flex items-center justify-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    平均输出 Token
                  </span>
                </th>
                {/* 各次尝试的列*/}
                {Array.from({ length: maxAttempts }, (_, i) => (
                  <th key={i} className="text-center py-3 px-2 font-medium min-w-[100px]">
                    第 {i + 1} 次
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modelStats.map((model, index) => (
                <tr key={model.key} className="border-b hover:bg-muted/20transition-colors">
                  {/* 模型名称 */}
                  <td className="py-3 px-4 sticky left-0 bg-background z-10">
                    <div className="flex items-center gap-2">
                      {getRankIcon(index + 1)}
                      <span className="font-medium break-words">{model.label}</span>
                    </div>
                  </td>
                  {/* Pass@k */}
                  <td className="text-center py-3 px-3">
                    <Badge variant={model.passAtK ? 'default' : 'secondary'} className="text-xs">
                      {model.passAtK ? (<><Check className="h-3 w-3 mr-0.5" />通过</>
                      ) : (
                        <><X className="h-3 w-3 mr-0.5" />未通过</>
                      )}
                </Badge>
                  </td>
                  {/* 准确率 */}
                  <td className="text-center py-3 px-3">
                    <span className={cn(
                      "font-semibold",
                      model.accuracy >= 0.8 ? "text-green-600 dark:text-green-400" :
                      model.accuracy >= 0.5 ? "text-amber-600 dark:text-amber-400" :
                      "text-red-600 dark:text-red-400"
                    )}>
                      {(model.accuracy * 100).toFixed(0)}%
                    </span>
                <span className="text-xs text-muted-foreground ml-1">
                      ({model.passCount}/{model.totalAttempts})
                    </span>
                  </td>
                  {/* 平均耗时 */}
                  <td className="text-center py-3 px-3 text-muted-foreground">
                    {model.avgDurationMs > 0 ? `${(model.avgDurationMs / 1000).toFixed(1)}s` : '--'}
                  </td>
                  {/* 输出 Token (平均) */}
                  <td className="text-center py-3 px-3 text-muted-foreground">
                    {model.avgOutputTokens > 0 ? model.avgOutputTokens.toLocaleString() : '--'}
                  </td>
                  {/* 各次尝试*/}
                  {Array.from({ length: maxAttempts }, (_, i) => {
                    const attempt = model.attempts.find(a => a.index === i + 1)
                    if (!attempt) {
                      return <td key={i} className="text-center py-3 px-2 text-muted-foreground/50">--</td>
                    }
                    return (
                      <td key={i} className="text-center py-3 px-2">
                        <div className="flex flex-col items-center gap-0.5">
                          {/* 状态/分数 */}
                          {attempt.error ? (
                            <Badge variant="destructive" className="text-xs">错误</Badge>
                          ) : attempt.passed != null ? (
                            <span className={cn(
                              "text-xs font-medium",
                              attempt.passed ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                            )}>
                              {attempt.passed ? '✓' : '✗'} {attempt.score?.toFixed(2) ?? '--'}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                          {/* 耗时 */}
                          <span className="text-[10px] text-muted-foreground">
                            {attempt.durationMs ? `${(attempt.durationMs / 1000).toFixed(1)}s` : '--'}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div><ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  )
}