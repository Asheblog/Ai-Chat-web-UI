'use client'

import { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { BattleShare, BattleResult } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Trophy, Medal, Award, Check, X, ChevronDown, ChevronRight, Clock, FileText, Loader2, AlertTriangle, ArrowDown } from 'lucide-react'
import { ModelStatsTable } from '@/features/battle/ui/ModelStatsTable'
import { FlowGraph } from '@/features/battle/ui/FlowGraph'
import { DetailDrawer, type BattleAttemptDetail } from '@/features/battle/ui/DetailDrawer'
import { BattleContentBlock } from '@/features/battle/ui/BattleContentBlock'
import { buildNodeStatesFromRun, type BattleNodeModel, type LiveAttempt, type NodeState } from '@/features/battle/hooks/useBattleFlow'
import { buildModelKey } from '@/features/battle/utils/model-key'
import { getBattleShare } from '@/features/battle/api'
import { DEFAULT_API_BASE_URL } from '@/lib/http/client'

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
      return { icon: <Medal className="h-6 w-6 text-muted-foreground" />, bg: 'bg-[hsl(var(--surface-hover))] border-border/70' }
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

export function BattleShareViewer({ share, brandText ='AIChat' }: BattleShareViewerProps) {
  const [shareState, setShareState] = useState(share)
  const payload = shareState.payload
  const refreshTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const mountedRef = useRef(true)
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  const [showQuestion, setShowQuestion] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<BattleAttemptDetail | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null)
  const [liveDeltas, setLiveDeltas] = useState<Map<string, { output: string; reasoning: string }>>(new Map())
  const isLive = payload.status === 'running' || payload.status === 'pending'
  const isLiveRef = useRef(isLive)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    isLiveRef.current = isLive
  }, [isLive])

  useEffect(() => {
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refreshShare = useCallback(async () => {
    if (!shareState.token) return
    try {
      const res = await getBattleShare(shareState.token)
      if (!mountedRef.current) return
      if (res?.success && res.data) {
        const latestShare = res.data
        setShareState(latestShare)
        setLiveDeltas((prev) => {
          if (prev.size === 0) return prev
          const activeKeys = new Set<string>()
          const liveAttempts = latestShare.payload.live?.attempts || []
          for (const attempt of liveAttempts) {
            const key = buildModelKey({
              modelId: attempt.modelId,
              connectionId: attempt.connectionId ?? null,
              rawId: attempt.rawId ?? null,
            })
            activeKeys.add(`${key}#${attempt.attemptIndex}`)
          }
          const results = latestShare.payload.results || []
          for (const result of results) {
            const key = buildModelKey({
              modelId: result.modelId,
              connectionId: result.connectionId ?? null,
              rawId: result.rawId ?? null,
            })
            activeKeys.add(`${key}#${result.attemptIndex}`)
          }
          const next = new Map(prev)
          for (const key of Array.from(activeKeys)) {
            next.delete(key)
          }
          return next
        })
      }
    } catch (error) {
      console.warn('[battle-share] failed to refresh', error)
    }
  }, [shareState.token])

  const queueRefresh = useCallback(() => {
    if (refreshTimerRef.current != null) return
    refreshTimerRef.current = window.setTimeout(async () => {
      refreshTimerRef.current = null
      await refreshShare()
    }, 300)
  }, [refreshShare])

  const startPolling = useCallback(() => {
    if (pollTimerRef.current != null) return
    pollTimerRef.current = window.setInterval(() => {
      if (!isLiveRef.current) return
      void refreshShare()
    }, 2000)
  }, [refreshShare])

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current == null) return
    window.clearInterval(pollTimerRef.current)
    pollTimerRef.current = null
  }, [])

  useEffect(() => {
    if (!shareState.token || !isLive) return
    const base = DEFAULT_API_BASE_URL.replace(/\/$/, '')
    const streamUrl = `${base}/battle/shares/${encodeURIComponent(shareState.token)}/stream`
    const source = new EventSource(streamUrl)
    eventSourceRef.current = source

    source.onmessage = (event) => {
      if (!event?.data || event.data === '[DONE]') return
      let eventPayload: any = null
      try {
        eventPayload = JSON.parse(event.data)
      } catch {
        return
      }
      if (!eventPayload) return
      if (eventPayload.type === 'share_update') {
        queueRefresh()
      }
      if (eventPayload.type === 'attempt_delta') {
        const data = eventPayload.payload || {}
        const modelKey = data.modelKey || buildModelKey({
          modelId: data.modelId,
          connectionId: data.connectionId ?? null,
          rawId: data.rawId ?? null,
        })
        const attemptIndex = Number(data.attemptIndex)
        if (!modelKey || !Number.isFinite(attemptIndex)) return
        const deltaKey = `${modelKey}#${attemptIndex}`
        const outputDelta = typeof data.delta === 'string' ? data.delta : ''
        const reasoningDelta = typeof data.reasoning === 'string' ? data.reasoning : ''
        if (!outputDelta && !reasoningDelta) return
        setLiveDeltas((prev) => {
          const next = new Map(prev)
          const current = next.get(deltaKey) || { output: '', reasoning: '' }
          next.set(deltaKey, {
            output: current.output + outputDelta,
            reasoning: current.reasoning + reasoningDelta,
          })
          return next
        })
        setSelectedDetail((prev) => {
          if (!prev || prev.modelKey !== modelKey || prev.attemptIndex !== attemptIndex) return prev
          return {
            ...prev,
            output: `${prev.output || ''}${outputDelta}`,
            reasoning: `${prev.reasoning || ''}${reasoningDelta}`,
          } as BattleAttemptDetail
        })
      }
      if (eventPayload.type === 'share_complete') {
        queueRefresh()
        source.close()
      }
    }

    source.onerror = () => {
      source.close()
      startPolling()
    }

    return () => {
      source.close()
      eventSourceRef.current = null
      stopPolling()
      if (refreshTimerRef.current != null) {
        window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [isLive, queueRefresh, shareState.token, startPolling, stopPolling])

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

  const normalizedResults = useMemo<BattleResult[]>(() => {
    return payload.results.map((result, index) => ({
      ...result,
      id: index + 1,
      battleRunId: shareState.battleRunId,
    } as BattleResult))
  }, [payload.results, shareState.battleRunId])

  const modelKeyMap = useMemo(() => {
    const map = new Map<string, { modelId: string; modelLabel: string | null; connectionId: number | null; rawId: string | null }>()
    for (const model of payload.models) {
      const key = buildModelKey({
        modelId: model.modelId,
        connectionId: model.connectionId ?? null,
        rawId: model.rawId ?? null,
      })
      map.set(key, {
        modelId: model.modelId,
        modelLabel: model.modelLabel ?? null,
        connectionId: model.connectionId ?? null,
        rawId: model.rawId ?? null,
      })
    }
    return map
  }, [payload.models])

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

  const nodeStates = useMemo<Map<string, NodeState[]>>(() => {
    if (!isLive) return new Map<string, NodeState[]>()
    const models: BattleNodeModel[] = payload.models.map((model) => ({
      modelId: model.modelId,
      connectionId: model.connectionId ?? null,
      rawId: model.rawId ?? null,
      label: model.modelLabel ?? undefined,
    }))
    const runsPerModel = Number.isFinite(payload.summary?.runsPerModel) ? payload.summary.runsPerModel : 1
    const liveAttempts = payload.live?.attempts as LiveAttempt[] | undefined
    return buildNodeStatesFromRun(models, runsPerModel, normalizedResults, undefined, liveAttempts)
  }, [isLive, payload.models, payload.summary?.runsPerModel, payload.live?.attempts, normalizedResults])

  const mergedNodeStates = useMemo(() => {
    if (liveDeltas.size === 0) return nodeStates
    const next = new Map<string, NodeState[]>()
    nodeStates.forEach((attempts, modelKey) => {
      const updated = attempts.map((attempt) => {
        const delta = liveDeltas.get(`${modelKey}#${attempt.attemptIndex}`)
        if (!delta) return attempt
        return {
          ...attempt,
          output: `${attempt.output || ''}${delta.output}`,
          reasoning: `${attempt.reasoning || ''}${delta.reasoning}`,
        }
      })
      next.set(modelKey, updated)
    })
    return next
  }, [liveDeltas, nodeStates])

  const progressPercentage = useMemo(() => {
    if (!payload.progress?.totalAttempts) return 0
    return Math.min(100, (payload.progress.completedAttempts / payload.progress.totalAttempts) * 100)
  }, [payload.progress?.completedAttempts, payload.progress?.totalAttempts])

  const statusMeta = useMemo(() => {
    if (isLive) {
      return {
        icon: <Loader2 className="h-5 w-5 text-primary animate-spin" />,
        label: '对战进行中',
        badge: '实时',
      }
    }
    if (payload.status === 'error') {
      return {
        icon: <AlertTriangle className="h-5 w-5 text-destructive" />,
        label: '对战出错',
      }
    }
    if (payload.status === 'cancelled') {
      return {
        icon: <AlertTriangle className="h-5 w-5 text-muted-foreground" />,
        label: '对战已取消',
      }
    }
    return {
      icon: <Trophy className="h-5 w-5 text-yellow-500" />,
      label: '对战完成',
    }
  }, [isLive, payload.status])

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
    const modelKey = buildModelKey({
      modelId: attempt.modelId,
      connectionId: attempt.connectionId ?? null,
      rawId: attempt.rawId ?? null,
    })
    const detail: BattleAttemptDetail = {
      ...attempt,
      id: normalizedResults.find((item) => item.modelId === attempt.modelId
        && item.connectionId === attempt.connectionId
        && item.rawId === attempt.rawId
        && item.attemptIndex === attempt.attemptIndex)?.id || 0,
      battleRunId: shareState.battleRunId,
      modelKey,
      isLive: false,
    }
    setSelectedNodeKey(`${modelKey}-${attempt.attemptIndex}`)
    setSelectedDetail(detail)
    setDrawerOpen(true)
  }

  const handleNodeClick = useCallback((modelKey: string, attemptIndex: number) => {
    const attempts = mergedNodeStates.get(modelKey)
    const attempt = attempts?.find((item) => item.attemptIndex === attemptIndex)
    if (!attempt) return
    const modelInfo = modelKeyMap.get(modelKey)
    const matchedResult = normalizedResults.find((item) => (
      buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
      }) === modelKey && item.attemptIndex === attemptIndex
    ))
    if (matchedResult) {
      setSelectedDetail({
        ...matchedResult,
        modelKey,
        isLive: false,
      })
    } else {
      setSelectedDetail({
        isLive: true,
        modelKey,
        modelId: modelInfo?.modelId || '',
        modelLabel: modelInfo?.modelLabel ?? attempt.modelLabel,
        attemptIndex,
        output: attempt.output,
        reasoning: attempt.reasoning,
        durationMs: attempt.durationMs ?? null,
        error: attempt.error ?? null,
        status: attempt.status,
        judgeStatus: attempt.judgeStatus,
        judgeError: attempt.judgeError,
        judgePass: attempt.judgePass,
        judgeScore: attempt.judgeScore,
        judgeReason: attempt.judgeReason,
      })
    }
    setSelectedNodeKey(`${modelKey}-${attemptIndex}`)
    setDrawerOpen(true)
  }, [mergedNodeStates, modelKeyMap, normalizedResults])

  const scrollToResults = useCallback(() => {
    const target = resultsRef.current
    if (!target) return
    const prefersReducedMotion = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  }, [])

  return (
    <div className="flex min-h-screen flex-col bg-[hsl(var(--background))] text-foreground"><div className="mx-auto flex-1 w-full max-w-[1100px] px-4 py-8 md:px-6 lg:px-8 space-y-6">
        <div className="flex items-center justify-between border-b border-border/80 pb-4">
          <div className="flex items-center gap-3 text-sm font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(var(--accent-color)))] text-xs font-bold text-primary-foreground">
              AI
            </span>
            {brandText} Battle 分享
          </div>
          <span className="text-xs text-muted-foreground">{formatRelativeTime(shareState.createdAt)}</span>
        </div>
        {/* Header */}
        <header className="flex flex-col gap-3">
          {/* Summary line */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              {statusMeta.icon}
              <span className="font-semibold text-foreground">{statusMeta.label}</span>
              {statusMeta.badge && (
                <Badge variant="secondary" className="text-xs">
                  {statusMeta.badge}
                </Badge>
              )}
            </div>
            <span className="text-muted-foreground/40">·</span>
            {isLive ? (
              <>
                <span className="font-semibold text-foreground">
                  {payload.progress.completedAttempts}/{payload.progress.totalAttempts} 已完成
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>进行中 {payload.progress.runningAttempts}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>等待 {payload.progress.pendingAttempts}</span>
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">
                  {payload.summary.passModelCount}/{payload.summary.totalModels}模型通过
                </span>
              </>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span>阈值 {payload.judge.threshold.toFixed(2)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatRelativeTime(shareState.createdAt)}</span>
          </div>
          <div>
            <Button variant="outline" size="sm" className="gap-2" onClick={scrollToResults}>
              <ArrowDown className="h-4 w-4" />
              直达结果
            </Button>
          </div>
        </header>

        {/* Question - collapsible */}
        <div>
          <button
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
            onClick={() => setShowQuestion(!showQuestion)}
          >
            {showQuestion ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}<FileText className="h-4 w-4" />
            查看题目与期望答案
          </button>
          {showQuestion && (
            <div className="mt-3 rounded-lg bg-muted/30 p-4 space-y-3">
              <BattleContentBlock
                title="题目"
                text={payload.prompt.text}
                images={payload.prompt.images}
              />
              <BattleContentBlock
                title="期望答案"
                text={payload.expectedAnswer.text}
                images={payload.expectedAnswer.images}
              />
              <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t border-border/50">
                <span>裁判模型：{payload.judge.modelLabel || payload.judge.modelId}</span></div>
            </div>
          )}
        </div>

        {isLive && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">对战进度</span>
                <span className="font-medium">
                  {payload.progress.completedAttempts}/{payload.progress.totalAttempts}
                </span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                通过 {payload.progress.successAttempts} · 未通过 {payload.progress.failedAttempts}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">进行中</div>
                  <div className="text-2xl font-bold text-blue-500">{payload.progress.runningAttempts}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-500/10 to-green-600/5">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">已完成</div>
                  <div className="text-2xl font-bold text-green-500">{payload.progress.completedAttempts}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">等待</div>
                  <div className="text-2xl font-bold text-amber-500">{payload.progress.pendingAttempts}</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5">
                <CardContent className="pt-4">
                  <div className="text-xs text-muted-foreground">通过</div>
                  <div className="text-2xl font-bold text-purple-500">{payload.progress.successAttempts}</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="pt-4">
                <FlowGraph
                  judgeLabel={payload.judge.modelLabel || payload.judge.modelId}
                  nodeStates={mergedNodeStates}
                  isRunning
                  selectedNodeKey={selectedNodeKey || undefined}
                  onNodeClick={handleNodeClick}
                />
              </CardContent>
            </Card>

            <div ref={resultsRef} id="battle-results" className="scroll-mt-24" />
            <div className="space-y-3">
              {Array.from(mergedNodeStates.entries()).map(([modelKey, attempts]) => {
                const latest = attempts.reduce<NodeState | null>((acc, item) => {
                  if (!acc) return item
                  return item.attemptIndex >= acc.attemptIndex ? item : acc
                }, null)
                if (!latest) return null
                const summary = getOutputSummary(latest.output || '')
                return (
                  <Card key={modelKey} className="bg-background/70 border-border/60">
                    <button
                      type="button"
                      className="w-full text-left hover:bg-muted/30 transition-colors rounded-lg"
                      onClick={() => handleNodeClick(modelKey, latest.attemptIndex)}
                    >
                      <CardContent className="pt-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-semibold break-words">{latest.modelLabel}</span>
                              <Badge variant="secondary" className="text-xs">
                                {latest.status === 'running' ? '进行中' : latest.status === 'judging' ? '评测中' : latest.status === 'success' ? '完成' : latest.status === 'error' ? '错误' : '等待'}
                              </Badge>
                              <Badge variant="outline" className="text-xs">#{latest.attemptIndex}</Badge>
                            </div>
                            {summary ? (
                              <p className="text-xs text-muted-foreground line-clamp-2">{summary}</p>
                            ) : (
                              <p className="text-xs text-muted-foreground">暂无输出</p>
                            )}
                          </div>
                          {latest.durationMs != null && (
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {(latest.durationMs / 1000).toFixed(1)}s
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </button>
                  </Card>
                )
              })}
            </div>

            <div className="text-xs text-muted-foreground">
              对战结束后会自动切换到结果页面。
            </div>
          </div>
        )}

        {/* Model Stats Table */}
        {!isLive && (
          <ModelStatsTable
            groupedResults={rankedModels}
            statsMap={adaptedStatsMap}
            className="mb-4"
          />
        )}

        {/* Model cards */}
        {!isLive && (
          <div ref={resultsRef} id="battle-results" className="scroll-mt-24" />
        )}

        {!isLive && (
          <div className="space-y-3">
          {rankedModels.map((group, index) => {
            const stat = statsMap.get(group.key)
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
                {/* Model row */}
                <button
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-black/5 dark:hover:bg-white/5 rounded-xl transition-colors"
                  onClick={() => toggleExpand(group.key)}
                >
                  {/* Rank */}
                  <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-background/80 border border-border/50">
                    {rank.icon}
                  </div>

                  {/* Model info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm break-words">{group.label}</span>
                      <Badge
                        variant={stat?.passAtK ?'default' : 'secondary'}
                        className="flex-shrink-0 text-xs"
                      >
                        {stat?.passAtK ? (
                          <><Check className="h-3 w-3 mr-0.5" />通过</>
                        ) : (
                          <><X className="h-3 w-3 mr-0.5" />未通过</>
                        )}
                      </Badge>
                    </div>
                    {outputSummary && (
                      <p className="text-xs text-muted-foreground line-clamp-1">
                        {outputSummary}
                      </p>
                    )}
                  </div>

                  {/* Accuracy */}
                  <div className="flex-shrink-0 text-right px-2">
                    <div className="text-base font-bold">
                      {stat ? `${(stat.accuracy * 100).toFixed(0)}%` : '--'}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {stat?.passCount ?? 0}/{(stat as any)?.totalAttempts ?? group.attempts.length} 通过
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
                        className="flex items-center justify-between gap-4 py-2 px-4 rounded-lg bg-background/60 cursor-pointer hover:bg-background transition-colors"
                        onClick={() => handleAttemptClick(attempt)}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground min-w-[4.5rem]">
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
                        <div className="text-sm text-muted-foreground">
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
        )}
      </div><footer className="border-t border-border/80 py-4">
        <div className="mx-auto w-full max-w-[1100px] px-4 text-center text-sm text-muted-foreground md:px-6 lg:px-8">
          由<span className="font-medium text-foreground">{brandText}</span> 生成 · {formatDate(shareState.createdAt)}
        </div>
      </footer>

      {/* Detail Drawer */}
        <DetailDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          detail={selectedDetail}
          isRunning={isLive}
        />

      <div className="fixed bottom-6 right-4 sm:right-6 z-50">
        <Button
          variant="default"
          size="icon"
          className="h-11 w-11 rounded-full shadow-md"
          onClick={scrollToResults}
          aria-label="直达模型输出"
          title="直达模型输出"
        >
          <ArrowDown className="h-5 w-5" />
        </Button>
      </div>
    </div>
  )
}
