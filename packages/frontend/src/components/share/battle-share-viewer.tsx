'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { BattleShare } from '@/types'
import { Badge } from '@/components/ui/badge'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { formatDate } from '@/lib/utils'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Trophy, Medal, Award, Check, X, ChevronDown, ChevronRight, Clock, FileText, Scale, AlertCircle } from 'lucide-react'
import { ModelStatsTable } from '@/features/battle/ui/ModelStatsTable'

interface BattleShareViewerProps {
  share: BattleShare
  brandText?: string
}

type AttemptResult = BattleShare['payload']['results'][number]

const formatRelativeTime = (dateStr: string): string => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`
  if (diffHours < 24) return `${diffHours} 小时前`
  if (diffDays < 7) return `${diffDays} 天前`

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

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

// 截取推理内容摘要
const getReasoningSummary = (reasoning: string | null | undefined, maxLen = 100): string => {
  if (!reasoning) return ''
  const cleaned = reasoning.replace(/\n+/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen) + '...'
}

export function BattleShareViewer({ share, brandText ='AIChat' }: BattleShareViewerProps) {
  const payload = share.payload
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [showQuestion, setShowQuestion] = useState(false)
  const [selectedAttempt, setSelectedAttempt] = useState<AttemptResult | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const statsMap = useMemo(() => {
    const map = new Map<string, typeof payload.summary.modelStats[number]>()
    const stats = Array.isArray(payload.summary.modelStats) ? payload.summary.modelStats : []
    for (const item of stats) {
      const key = `${item.connectionId ?? 'global'}:${item.rawId ?? item.modelId}`
      map.set(key, item)
    }
    return map
  }, [payload.summary.modelStats])

  const groupedResults = useMemo(() => {
    const map = new Map<string, { key: string; label: string; attempts: typeof payload.results }>()
    for (const result of payload.results) {
      const key = `${result.connectionId ?? 'global'}:${result.rawId ?? result.modelId}`
      const label = result.modelLabel || result.modelId
      const existing = map.get(key) || { key, label, attempts: [] }
      existing.attempts.push(result)
      map.set(key, existing)
    }
    return Array.from(map.values())
  }, [payload.results])

  // Sort by passAtK and accuracy
  const rankedModels = useMemo(() => {
    return [...groupedResults].sort((a, b) => {
      const statA = statsMap.get(a.key)
      const statB = statsMap.get(b.key)
      if (statA?.passAtK !== statB?.passAtK) {
        return statA?.passAtK ? -1 : 1
      }
      return (statB?.accuracy ?? 0) - (statA?.accuracy ?? 0)
    })
  }, [groupedResults, statsMap])

  // Adapt statsMap for ModelStatsTable
  const adaptedStatsMap = useMemo(() => {
    const map = new Map<string, { passAtK: boolean; passCount: number; accuracy: number; judgedCount: number; totalAttempts: number }>()
    statsMap.forEach((stat, key) => {
      const group = groupedResults.find(g => g.key === key)
      map.set(key, {
        passAtK: stat.passAtK ?? false,
        passCount: stat.passCount ?? 0,
        accuracy: stat.accuracy ?? 0,
        judgedCount: group?.attempts.filter(a => a.judgePass != null).length ?? 0,
        totalAttempts: group?.attempts.length ?? 0,
      })
    })
    return map
  }, [statsMap, groupedResults])

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

  const handleAttemptClick = (attempt: AttemptResult) => {
    setSelectedAttempt(attempt)
    setDrawerOpen(true)
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col"><div className="flex-1 w-full px-4 md:px-8 lg:px-12 py-8 space-y-6">
        {/* Header */}
        <header className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Trophy className="h-7 w-7 text-yellow-500" />
            <h1 className="text-2xl font-bold">{share.title || payload.title}</h1>
          </div>
          {/* Summary line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-base text-muted-foreground">
            <span className="font-semibold text-foreground text-lg">
              {payload.summary.passModelCount}/{payload.summary.totalModels}模型通过
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span>阈值 {payload.judge.threshold.toFixed(2)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatRelativeTime(share.createdAt)}</span>
          </div>
        </header>

        {/* Question - collapsible */}
        <div>
          <button
            className="flex items-center gap-2 text-base text-muted-foreground hover:text-foreground transition-colors py-1"
            onClick={() => setShowQuestion(!showQuestion)}
          >
            {showQuestion ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}<FileText className="h-5 w-5" />
            查看题目与期望答案
          </button>
          {showQuestion && (
            <div className="mt-3 rounded-lg bg-muted/30 p-5 space-y-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">题目</div>
                <div className="prose prose-base max-w-none dark:prose-invert">
                  <MarkdownRenderer html={null} fallback={payload.prompt} />
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-2">期望答案</div>
                <div className="prose prose-base max-w-none dark:prose-invert">
                  <MarkdownRenderer html={null} fallback={payload.expectedAnswer} />
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2 border-t border-border/50">
                <span>裁判模型：{payload.judge.modelLabel || payload.judge.modelId}</span></div>
            </div>
          )}
        </div>

        {/* Model Stats Table */}
        <ModelStatsTable
          groupedResults={rankedModels}
          statsMap={adaptedStatsMap}
          className="mb-4"
        />

        {/* Model cards */}
        <div className="space-y-3">
          {rankedModels.map((group, index) => {
            const stat = statsMap.get(group.key)
            const isExpanded = expandedModels.has(group.key)
            const rank = getRankDisplay(index + 1)
            const bestAttempt = group.attempts.find(a => a.judgePass) || group.attempts[0]
            const reasoningSummary = getReasoningSummary(bestAttempt?.reasoning)

            return (
              <div
                key={group.key}
                className={cn(
                  "rounded-xl border transition-all",
                  rank.bg,
                  isExpanded && "shadow-sm"
                )}
              >
                {/* Model row */}
                <button
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
                  onClick={() => toggleExpand(group.key)}
                >
                  {/* Rank */}
                  <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-background/80 border border-border/50">
                    {rank.icon}
                  </div>

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-semibold text-lg truncate">{group.label}</span>
                      <Badge
                        variant={stat?.passAtK ?'default' : 'secondary'}
                        className="flex-shrink-0"
                      >
                        {stat?.passAtK ? (
                          <><Check className="h-3.5 w-3.5 mr-1" />通过</>
                        ) : (
                          <><X className="h-3.5 w-3.5 mr-1" />未通过</>
                        )}
                </Badge>
                    </div>
                    {reasoningSummary && (
                      <p className="text-sm text-muted-foreground line-clamp-1">
                        {reasoningSummary}
                      </p>
                    )}
                  </div>

                  {/* Accuracy */}
                  <div className="flex-shrink-0 text-right px-2">
                    <div className="text-xl font-bold">
                      {stat ? `${(stat.accuracy * 100).toFixed(0)}%` : '--'}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {stat?.passCount ?? 0}/{group.attempts.length} 通过
                    </div>
                  </div>

                  {/* Expand indicator */}
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded attempts -简单行列表 */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-2">
                    <div className="border-t border-border/50 mb-3" />
                    {group.attempts.map((attempt) => (
                      <div
                        key={`${attempt.modelId}-${attempt.attemptIndex}`}
                        className="flex items-center justify-between gap-4 py-3 px-4 rounded-lg bg-background/60 cursor-pointer hover:bg-background transition-colors"
                        onClick={() => handleAttemptClick(attempt)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-base text-muted-foreground min-w-[5rem]">
                            第{attempt.attemptIndex} 次
                          </span>
                          {attempt.error ? (
                            <Badge variant="destructive">错误</Badge>
                          ) : attempt.judgePass != null ? (
                            <Badge variant={attempt.judgePass ? 'outline' : 'secondary'}>
                              {attempt.judgePass ? '✓' : '✗'} {attempt.judgeScore?.toFixed(2) ?? '--'}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">--</Badge>
                          )}
                        </div>
                        <div className="text-base text-muted-foreground">
                          {attempt.durationMs != null ? `${(attempt.durationMs / 1000).toFixed(1)}s` : '--'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div><footer className="border-t bg-muted/30 py-4">
        <div className="w-full px-4 md:px-8 lg:px-12 text-center text-sm text-muted-foreground">
          由<span className="font-medium text-foreground">{brandText}</span> 生成 · {formatDate(share.createdAt)}
        </div>
      </footer>

      {/* Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          dialogTitle={`${selectedAttempt?.modelLabel || selectedAttempt?.modelId || '模型输出详情'} #${selectedAttempt?.attemptIndex}`}
          className="w-[95vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0"
        >
          {selectedAttempt && (
            <ScrollArea className="h-full">
              <div className="p-6 space-y-5">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <h2 className="text-lg font-semibold">{selectedAttempt.modelLabel || selectedAttempt.modelId}</h2>
                    <Badge variant="outline" className="text-xs">#{selectedAttempt.attemptIndex}</Badge>
                  </div>
                  {/* Status badges */}
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {selectedAttempt.error ? (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <AlertCircle className="h-3 w-3" />
                        错误
                      </Badge>
                    ) : selectedAttempt.judgePass != null ? (
                      <Badge
                        variant={selectedAttempt.judgePass ? 'default' : 'destructive'}
                        className="text-xs gap-1"
                      >
                        {selectedAttempt.judgePass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {selectedAttempt.judgePass ? '通过' : '未通过'}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">未评测</Badge>
                    )}
                    {selectedAttempt.durationMs != null && (
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {(selectedAttempt.durationMs / 1000).toFixed(2)}s
                      </span>
                    )}
                    {selectedAttempt.judgeFallbackUsed && (
                      <Badge variant="secondary" className="text-xs">阈值兜底</Badge>
                    )}
                  </div>
                </div>

                {/* Error */}
                {selectedAttempt.error && (
                  <div className="rounded-lg bg-destructive/10 p-3">
                    <div className="flex items-center gap-2 text-sm text-destructive font-medium mb-1">
                      <AlertCircle className="h-4 w-4" />
                      执行错误
                    </div>
                    <p className="text-sm text-destructive/80">{selectedAttempt.error}</p>
                  </div>
                )}

                {/* Reasoning */}
                {selectedAttempt.reasoning && (
                  <div>
                    <h4 className="text-sm font-medium mb-2">推理过程</h4>
                    <div className="rounded-lg bg-muted/30 p-3">
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <MarkdownRenderer html={null} fallback={selectedAttempt.reasoning} />
                      </div>
                    </div>
                  </div>
                )}

                {/* Model Output */}
                <div>
                  <h4 className="text-sm font-medium mb-2">模型输出</h4>
                  <div className="rounded-lg bg-muted/30 p-3">
                    {selectedAttempt.output ? (
                      <div className="prose prose-sm max-w-none dark:prose-invert">
                        <MarkdownRenderer html={null} fallback={selectedAttempt.output} />
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">无输出内容</p>
                    )}
                  </div>
                </div>

                {/* Judge Evaluation */}
                {selectedAttempt.judgePass != null && (
                  <div>
                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Scale className="h-4 w-4" />
                      裁判评估
                    </h4>
                    <div className="rounded-lg bg-muted/30 p-3">
                      {/* Score bar */}
                      <div className="flex items-center gap-3 mb-2">
                        <div className={cn(
                          'text-2xl font-bold',
                          selectedAttempt.judgePass ? 'text-green-500' : 'text-destructive'
                        )}>
                          {selectedAttempt.judgeScore != null ? selectedAttempt.judgeScore.toFixed(2) : '--'}
                        </div>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              selectedAttempt.judgePass ? 'bg-green-500' : 'bg-destructive'
                            )}
                            style={{ width: `${(selectedAttempt.judgeScore ?? 0) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Reason */}
                      {selectedAttempt.judgeReason && (
                        <div className="text-sm text-muted-foreground">
                          <span className="text-xs text-muted-foreground/70">评判理由：</span>
                          {selectedAttempt.judgeReason}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
