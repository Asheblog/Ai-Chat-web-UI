'use client'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {Sheet,
    SheetContent,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Check, X, Clock, AlertCircle, Scale, ChevronDown, ChevronRight } from 'lucide-react'
import type { BattleResult } from '@/types'
import type { NodeStatus } from '../hooks/useBattleFlow'

interface DetailDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    detail: BattleAttemptDetail | null
    isRunning: boolean
    canCancelAttempt?: boolean
    canRetryAttempt?: boolean
    canRetryJudge?: boolean
    onCancelAttempt?: (detail: BattleAttemptDetail) => void
    onRetryAttempt?: (detail: BattleAttemptDetail) => void
    onRetryJudge?: (detail: BattleAttemptDetail) => void
}

export type BattleAttemptDetail =| (BattleResult & { isLive?: false; status?: NodeStatus; modelKey: string })
  | {
      isLive: true
      modelKey: string
      modelId: string
      modelLabel?: string | null
      attemptIndex: number
      output?: string
      reasoning?: string
      durationMs?: number | null
      error?: string | null
      status: NodeStatus
      usage?: Record<string, any>
      judgeStatus?: BattleResult['judgeStatus']
      judgeError?: string | null
      judgePass?: boolean | null
      judgeScore?: number | null
      judgeReason?: string | null
      judgeFallbackUsed?: boolean}

const statusBadgeLabel = (status: NodeStatus) => {
    switch (status) {
        case 'pending':
            return '待执行'
        case 'running':
            return '进行中'
        case 'judging':
            return '评测中'
        case 'success':
            return '完成'
        case 'error':
            return '错误'
        default:
            return '未知'
    }
}

export function DetailDrawer({
    open,
    onOpenChange,
    detail,
    isRunning,
    canCancelAttempt,
    canRetryAttempt,
    canRetryJudge,
    onCancelAttempt,
    onRetryAttempt,
    onRetryJudge,
}: DetailDrawerProps) {
    const isLive = detail?.isLive === true
    const title = detail?.modelLabel || detail?.modelId || ''
    const usage = detail?.usage || {}
    const reasoning = (detail?.reasoning || '').trim()
    const reasoningHeavy = reasoning.length >= 4000
    const detailSignature = detail ? `${detail.modelId}:${detail.attemptIndex}:${detail.isLive ?'live' : 'static'}` : ''
    const [renderReasoning, setRenderReasoning] = useState(!reasoningHeavy)
    const [manualOverride, setManualOverride] = useState(false)
    const [showReasoning, setShowReasoning] = useState(true)

    useEffect(() => {
        if (!detailSignature) return
        setManualOverride(false)
        setRenderReasoning(!reasoningHeavy)}, [detailSignature, reasoningHeavy])

    useEffect(() => {
        if (!manualOverride && reasoningHeavy && renderReasoning) {
            setRenderReasoning(false)
        }
    }, [manualOverride, reasoningHeavy, renderReasoning])

    const toggleReasoningRender = () => {
        setManualOverride(true)
        setRenderReasoning((prev) => !prev)
    }

    if (!detail) return null

    const judgeStatus = (detail as any).judgeStatus as BattleResult['judgeStatus'] | undefined
    const judgeError = (detail as any).judgeError as string | null | undefined
    const judgeReady = judgeStatus === 'success'
    const judgeRunning = judgeStatus === 'running'
    const judgeFailed = judgeStatus === 'error'
    const judgeUnknown = !judgeStatus || judgeStatus === 'unknown' || judgeStatus === 'skipped'

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
                dialogTitle={`${title || '模型输出详情'} #${detail.attemptIndex}`}
                className="w-[95vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0"
            >
                <ScrollArea className="h-full">
                    <div className="p-6 space-y-5">
                        {/* Header */}
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <h2 className="text-lg font-semibold">{title}</h2>
                                <Badge variant="outline" className="text-xs">#{detail.attemptIndex}</Badge>
                            </div>
                            {/* Status badges -紧凑显示 */}
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                {isLive ? (
                                    <Badge
                                        variant={detail.status === 'error' ? 'destructive' : 'secondary'}
                                        className="text-xs"
                                    >
                                        {statusBadgeLabel(detail.status)}
                                    </Badge>
                                ) : (
                                    <>
                                        {judgeRunning ? (
                                            <Badge variant="secondary" className="text-xs gap-1">
                                                <Clock className="h-3 w-3" />
                                                评测中
                                            </Badge>
                                        ) : judgeFailed ? (
                                            <Badge variant="destructive" className="text-xs gap-1">
                                                <AlertCircle className="h-3 w-3" />
                裁判失败
                                            </Badge>
                                        ) : judgeUnknown ? (
                                            <Badge variant="secondary" className="text-xs">未评测</Badge>
                                        ) : (<Badge
                                                variant={detail.judgePass ? 'default' : 'destructive'}
                                                className="text-xs gap-1"
                                            >
                                                {detail.judgePass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                                                {detail.judgePass ? '通过' : '未通过'}
                                            </Badge>
                                        )}</>
                                )}{detail.durationMs != null && (
                                    <span className="text-muted-foreground flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {(detail.durationMs / 1000).toFixed(2)}s
                                    </span>
                                )}
                {!isLive && detail.judgeFallbackUsed && (
                                    <Badge variant="secondary" className="text-xs">阈值兜底</Badge>
                                )}
                            </div>

                            {/* Action buttons */}
                            {((canCancelAttempt || canRetryAttempt) && isRunning) || (!isLive && canRetryJudge) ? (
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    {canCancelAttempt && isRunning && (
                                        <Button variant="outline" size="sm" onClick={() => onCancelAttempt?.(detail)}>
                                            取消
                                        </Button>
                                    )}
                                    {canRetryAttempt && isRunning && (<Button size="sm" onClick={() => onRetryAttempt?.(detail)}>
                                            重试
                                        </Button>
                                    )}
                                    {!isLive && canRetryJudge && (
                                        <Button variant="outline" size="sm" onClick={() => onRetryJudge?.(detail)}>
                                            重试裁判</Button>
                                    )}
                                </div>
                            ) : null}
                        </div>

                        {/* Error */}
                        {detail.error && (
                            <div className="rounded-lg bg-destructive/10 p-3">
                                <div className="flex items-center gap-2 text-sm text-destructive font-medium mb-1">
                                    <AlertCircle className="h-4 w-4" />
                                    执行错误
                                </div>
                                <p className="text-sm text-destructive/80">{detail.error}</p>
                            </div>
                        )}

                        {/* Reasoning -可折叠 */}
                        {reasoning && (
                            <div>
                                <button
                                    className="flex items-center gap-2 text-sm font-medium mb-2hover:text-foreground text-muted-foreground transition-colors"
                                    onClick={() => setShowReasoning(!showReasoning)}
                                >
                                    {showReasoning ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    推理过程
                                    {reasoningHeavy && (<span className="text-xs text-muted-foreground font-normal">
                                            ({Math.ceil(reasoning.length / 1000)}k 字符)
                                        </span>
                                    )}
                                </button>
                                {showReasoning && (<div className="rounded-lg bg-muted/30 p-3">
                                        {reasoningHeavy && (
                                            <div className="flex justify-end mb-2">
                                                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={toggleReasoningRender}>
                                                    {renderReasoning ? '性能模式' : '渲染公式'}
                                                </Button>
                                            </div>
                                        )}
                                        {renderReasoning ? (
                                            <div className="prose prose-sm max-w-none dark:prose-invert">
                                                <MarkdownRenderer html={null} fallback={reasoning} />
                                            </div>
                                        ) : (
                                            <pre className="text-sm whitespace-pre-wrap break-words font-mono text-foreground/90">{reasoning}</pre>
                                        )}</div>
                                )}
                            </div>
                        )}

                        {/* Model Output */}
                        <div>
                            <h4 className="text-sm font-medium mb-2">模型输出</h4>
                            <div className="rounded-lg bg-muted/30 p-3">
                                {detail.output ? (
                                    <div className="prose prose-sm max-w-none dark:prose-invert"><MarkdownRenderer html={null} fallback={detail.output} />
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">无输出内容</p>
                                )}
                            </div>
                        </div>

                        {/* Judge Evaluation - 精简*/}
                        {!isLive && (
                            <div>
                                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                    <Scale className="h-4 w-4" />裁判评估
                                </h4>
                                <div className="rounded-lg bg-muted/30 p-3">
                                    {/* Score bar */}
                                    <div className="flex items-center gap-3 mb-2"><div className={cn(
                                            'text-2xl font-bold',
                                            detail.judgePass ? 'text-green-500' : 'text-destructive'
                                        )}>
                                            {judgeReady && detail.judgeScore != null ? detail.judgeScore.toFixed(2) : '--'}
                                        </div>
                                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                            <div
                                                className={cn(
                                                    'h-full rounded-full transition-all',detail.judgePass ? 'bg-green-500' : 'bg-destructive'
                                                )}
                                                style={{ width: `${judgeReady ? (detail.judgeScore ?? 0) * 100 : 0}%` }}
                                            /></div>
                                    </div>

                                    {/* Reason */}
                                    {detail.judgeReason && (<div className="text-sm text-muted-foreground"><span className="text-xs text-muted-foreground/70">评判理由：</span>
                                            {detail.judgeReason}
                                        </div>
                                    )}

                                    {!detail.judgeReason && judgeError && (
                                        <div className="text-sm text-destructive"><span className="text-xs">错误：</span>
                                            {judgeError}</div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Usage Stats - 更紧凑 */}
                        {Object.keys(usage).length > 0 && (
                            <div>
                                <h4 className="text-sm font-medium mb-2">Token 使用</h4>
                                <div className="flex flex-wrap gap-4text-sm">
                                    {usage.prompt_tokens != null && (
                                        <div><span className="text-muted-foreground">输入：</span><span className="font-medium">{usage.prompt_tokens}</span></div>
                                    )}
                                    {usage.completion_tokens != null && (
                                        <div>
                                            <span className="text-muted-foreground">输出：</span><span className="font-medium">{usage.completion_tokens}</span>
                                        </div>
                                    )}
                                    {usage.total_tokens != null && (
                                        <div>
                                            <span className="text-muted-foreground">总计：</span>
                                            <span className="font-medium">{usage.total_tokens}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    )
}
