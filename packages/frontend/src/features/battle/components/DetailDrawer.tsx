'use client'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
    Sheet,
    SheetContent,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Check, X, Clock, AlertCircle, Scale } from 'lucide-react'
import type { BattleResult } from '@/types'
import type { NodeStatus } from '../hooks/useBattleFlow'

interface DetailDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    detail: BattleAttemptDetail | null
}

export type BattleAttemptDetail =
  | (BattleResult & { isLive?: false; status?: NodeStatus })
  | {
      isLive: true
      modelId: string
      modelLabel?: string | null
      attemptIndex: number
      output?: string
      reasoning?: string
      durationMs?: number | null
      error?: string | null
      status: NodeStatus
      usage?: Record<string, any>
      judgePass?: boolean | null
      judgeScore?: number | null
      judgeReason?: string | null
      judgeFallbackUsed?: boolean
    }

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

export function DetailDrawer({ open, onOpenChange, detail }: DetailDrawerProps) {
    if (!detail) return null

    const isLive = detail.isLive === true
    const title = detail.modelLabel || detail.modelId
    const usage = detail.usage || {}
    const reasoning = (detail.reasoning || '').trim()
    const reasoningHeavy = reasoning.length >= 4000
    const [renderReasoning, setRenderReasoning] = useState(!reasoningHeavy)
    const [manualOverride, setManualOverride] = useState(false)

    useEffect(() => {
        setManualOverride(false)
        setRenderReasoning(!reasoningHeavy)
    }, [detail.modelId, detail.attemptIndex, detail.isLive])

    useEffect(() => {
        if (!manualOverride && reasoningHeavy && renderReasoning) {
            setRenderReasoning(false)
        }
    }, [manualOverride, reasoningHeavy, renderReasoning])

    const toggleReasoningRender = () => {
        setManualOverride(true)
        setRenderReasoning((prev) => !prev)
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[95vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl p-6">
                <div className="mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        {title}
                        <Badge variant="outline">#{detail.attemptIndex}</Badge>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        {isLive ? '实时输出更新中' : '查看模型输出详情和裁判评分'}
                    </p>
                </div>

                <ScrollArea className="h-[calc(100vh-120px)]">
                    <div className="space-y-6 pr-4">
                        {/* Status and Timing */}
                        <div className="flex flex-wrap items-center gap-3">
                            {isLive ? (
                                <Badge
                                    variant={detail.status === 'error' ? 'destructive' : 'secondary'}
                                    className="gap-1"
                                >
                                    {statusBadgeLabel(detail.status)}
                                </Badge>
                            ) : (
                                <Badge
                                    variant={detail.judgePass ? 'default' : 'destructive'}
                                    className="gap-1"
                                >
                                    {detail.judgePass ? (
                                        <>
                                            <Check className="h-3 w-3" />
                                            通过
                                        </>
                                    ) : (
                                        <>
                                            <X className="h-3 w-3" />
                                            未通过
                                        </>
                                    )}
                                </Badge>
                            )}
                            {detail.durationMs != null && (
                                <Badge variant="outline" className="gap-1">
                                    <Clock className="h-3 w-3" />
                                    {(detail.durationMs / 1000).toFixed(2)}s
                                </Badge>
                            )}
                            {!isLive && detail.judgeFallbackUsed && (
                                <Badge variant="secondary">阈值兜底</Badge>
                            )}
                        </div>

                        <Separator />

                        {/* Error (if any) */}
                        {detail.error && (
                            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                                    <AlertCircle className="h-4 w-4" />
                                    执行错误
                                </div>
                                <p className="text-sm text-destructive/80">{detail.error}</p>
                            </div>
                        )}

                        {/* Reasoning Output */}
                        {reasoning && (
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="text-sm font-medium">推理过程</h4>
                                    {reasoningHeavy && (
                                        <div className="flex items-center gap-2">
                                            {!renderReasoning && (
                                                <span className="text-xs text-muted-foreground">长文本已启用性能模式</span>
                                            )}
                                            <Button variant="ghost" size="sm" onClick={toggleReasoningRender}>
                                                {renderReasoning ? '性能模式' : '渲染公式'}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <div className="rounded-lg border bg-muted/30 p-3 overflow-x-auto">
                                    {renderReasoning ? (
                                        <div className="prose prose-sm max-w-none dark:prose-invert">
                                            <MarkdownRenderer html={null} fallback={reasoning} />
                                        </div>
                                    ) : (
                                        <pre className="text-sm whitespace-pre-wrap break-words font-mono text-foreground/90">{reasoning}</pre>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Model Output */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium">模型输出</h4>
                            <div className="rounded-lg border bg-muted/30 p-3 overflow-x-auto">
                                {detail.output ? (
                                    <div className="prose prose-sm max-w-none dark:prose-invert">
                                        <MarkdownRenderer html={null} fallback={detail.output} />
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">无输出内容</p>
                                )}
                            </div>
                        </div>

                        {!isLive && <Separator />}

                        {/* Judge Evaluation */}
                        {!isLive && (
                            <>
                                <div className="space-y-3">
                                    <h4 className="text-sm font-medium flex items-center gap-2">
                                        <Scale className="h-4 w-4" />
                                        裁判评估
                                    </h4>

                                    {/* Score */}
                                    <div className="flex items-center gap-4">
                                        <div>
                                            <div className="text-xs text-muted-foreground mb-1">评分</div>
                                            <div className={cn(
                                                'text-2xl font-bold',
                                                detail.judgePass ? 'text-green-500' : 'text-destructive'
                                            )}>
                                                {detail.judgeScore != null ? detail.judgeScore.toFixed(2) : '--'}
                                            </div>
                                        </div>
                                        <div className="flex-1">
                                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                                <div
                                                    className={cn(
                                                        'h-full rounded-full transition-all',
                                                        detail.judgePass ? 'bg-green-500' : 'bg-destructive'
                                                    )}
                                                    style={{ width: `${(detail.judgeScore ?? 0) * 100}%` }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Reason */}
                                    {detail.judgeReason && (
                                        <div className="rounded-lg border bg-muted/30 p-3">
                                            <div className="text-xs text-muted-foreground mb-1">评判理由</div>
                                            <p className="text-sm">{detail.judgeReason}</p>
                                        </div>
                                    )}
                                </div>

                                <Separator />
                            </>
                        )}

                        {/* Usage Stats */}
                        {Object.keys(usage).length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium">Token 使用</h4>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                    {usage.prompt_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">输入</div>
                                            <div className="text-sm font-medium">{usage.prompt_tokens}</div>
                                        </div>
                                    )}
                                    {usage.completion_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">输出</div>
                                            <div className="text-sm font-medium">{usage.completion_tokens}</div>
                                        </div>
                                    )}
                                    {usage.total_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">总计</div>
                                            <div className="text-sm font-medium">{usage.total_tokens}</div>
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
