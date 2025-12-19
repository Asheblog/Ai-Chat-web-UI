'use client'

import { useMemo } from 'react'
import type { BattleShare } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { formatDate } from '@/lib/utils'

interface BattleShareViewerProps {
  share: BattleShare
  brandText?: string
}

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

export function BattleShareViewer({ share, brandText = 'AIChat' }: BattleShareViewerProps) {
  const payload = share.payload
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

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex-1 mx-auto w-full max-w-4xl px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold">{share.title || payload.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatRelativeTime(share.createdAt)} · {payload.summary.totalModels} 个模型
          </p>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">题目信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-xs text-muted-foreground">题目</div>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownRenderer html={null} fallback={payload.prompt} />
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">期望答案</div>
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <MarkdownRenderer html={null} fallback={payload.expectedAnswer} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">裁判模型</div>
                <div className="font-medium text-sm">{payload.judge.modelLabel || payload.judge.modelId}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">判定阈值</div>
                <div className="font-medium text-sm">{payload.judge.threshold.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">pass@k 通过</div>
                <div className="font-medium text-sm">{payload.summary.passModelCount}/{payload.summary.totalModels}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">对战结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {groupedResults.map((group) => {
              const stat = statsMap.get(group.key)
              return (
                <div key={group.key} className="rounded-xl border border-border/70 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-sm">{group.label}</div>
                      <div className="text-xs text-muted-foreground">
                        通过 {stat?.passCount ?? 0}/{group.attempts.length}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {stat ? (
                        <Badge variant={stat.passAtK ? 'default' : 'secondary'}>
                          {stat.passAtK ? 'pass@k' : '未通过'}
                        </Badge>
                      ) : null}
                      {stat ? (
                        <Badge variant="outline">准确率 {(stat.accuracy * 100).toFixed(0)}%</Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="space-y-4">
                    {group.attempts.map((attempt) => (
                      <div key={`${attempt.modelId}-${attempt.attemptIndex}`} className="rounded-lg border border-border/60 p-3 space-y-3">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>第 {attempt.attemptIndex} 次</span>
                          <span>{attempt.durationMs != null ? `${attempt.durationMs}ms` : '--'}</span>
                        </div>
                        {attempt.error ? (
                          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {attempt.error}
                          </div>
                        ) : (
                          <div className="prose prose-sm max-w-none dark:prose-invert">
                            <MarkdownRenderer html={null} fallback={attempt.output} />
                          </div>
                        )}
                        <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant={attempt.judgePass ? 'default' : 'secondary'}>
                              {attempt.judgePass ? '通过' : '未通过'}
                            </Badge>
                            <span>score {attempt.judgeScore != null ? attempt.judgeScore.toFixed(2) : '--'}</span>
                            {attempt.judgeFallbackUsed ? (
                              <span className="text-muted-foreground">(阈值兜底)</span>
                            ) : null}
                          </div>
                          {attempt.judgeReason ? (
                            <div className="text-muted-foreground">{attempt.judgeReason}</div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <footer className="border-t bg-muted/30 py-4">
        <div className="mx-auto max-w-4xl px-4 text-center text-xs text-muted-foreground">
          本页面分享由 <span className="font-medium text-foreground">{brandText}</span> 系统生成 · {formatDate(share.createdAt)}
        </div>
      </footer>
    </div>
  )
}
