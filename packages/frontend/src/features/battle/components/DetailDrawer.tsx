'use client'
import { cn } from '@/lib/utils'
import {
    Sheet,
    SheetContent,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { MarkdownRenderer } from '@/components/markdown-renderer'
import { Check, X, Clock, AlertCircle, Scale } from 'lucide-react'
import type { BattleResult } from '@/types'

interface DetailDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    result: BattleResult | null
}

export function DetailDrawer({ open, onOpenChange, result }: DetailDrawerProps) {
    if (!result) return null

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[95vw] sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl p-6">
                <div className="mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        {result.modelLabel || result.modelId}
                        <Badge variant="outline">#{result.attemptIndex}</Badge>
                    </h2>
                    <p className="text-sm text-muted-foreground">
                        查看模型输出详情和裁判评分
                    </p>
                </div>

                <ScrollArea className="h-[calc(100vh-120px)]">
                    <div className="space-y-6 pr-4">
                        {/* Status and Timing */}
                        <div className="flex flex-wrap items-center gap-3">
                            <Badge
                                variant={result.judgePass ? 'default' : 'destructive'}
                                className="gap-1"
                            >
                                {result.judgePass ? (
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
                            {result.durationMs != null && (
                                <Badge variant="outline" className="gap-1">
                                    <Clock className="h-3 w-3" />
                                    {(result.durationMs / 1000).toFixed(2)}s
                                </Badge>
                            )}
                            {result.judgeFallbackUsed && (
                                <Badge variant="secondary">阈值兜底</Badge>
                            )}
                        </div>

                        <Separator />

                        {/* Error (if any) */}
                        {result.error && (
                            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2">
                                <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                                    <AlertCircle className="h-4 w-4" />
                                    执行错误
                                </div>
                                <p className="text-sm text-destructive/80">{result.error}</p>
                            </div>
                        )}

                        {/* Model Output */}
                        <div className="space-y-2">
                            <h4 className="text-sm font-medium">模型输出</h4>
                            <div className="rounded-lg border bg-muted/30 p-3 overflow-x-auto">
                                {result.output ? (
                                    <div className="prose prose-sm max-w-none dark:prose-invert">
                                        <MarkdownRenderer html={null} fallback={result.output} />
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground">无输出内容</p>
                                )}
                            </div>
                        </div>

                        <Separator />

                        {/* Judge Evaluation */}
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
                                        result.judgePass ? 'text-green-500' : 'text-destructive'
                                    )}>
                                        {result.judgeScore != null ? result.judgeScore.toFixed(2) : '--'}
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                                        <div
                                            className={cn(
                                                'h-full rounded-full transition-all',
                                                result.judgePass ? 'bg-green-500' : 'bg-destructive'
                                            )}
                                            style={{ width: `${(result.judgeScore ?? 0) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Reason */}
                            {result.judgeReason && (
                                <div className="rounded-lg border bg-muted/30 p-3">
                                    <div className="text-xs text-muted-foreground mb-1">评判理由</div>
                                    <p className="text-sm">{result.judgeReason}</p>
                                </div>
                            )}
                        </div>

                        <Separator />

                        {/* Usage Stats */}
                        {result.usage && Object.keys(result.usage).length > 0 && (
                            <div className="space-y-2">
                                <h4 className="text-sm font-medium">Token 使用</h4>
                                <div className="grid grid-cols-3 gap-3 text-center">
                                    {result.usage.prompt_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">输入</div>
                                            <div className="text-sm font-medium">{result.usage.prompt_tokens}</div>
                                        </div>
                                    )}
                                    {result.usage.completion_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">输出</div>
                                            <div className="text-sm font-medium">{result.usage.completion_tokens}</div>
                                        </div>
                                    )}
                                    {result.usage.total_tokens != null && (
                                        <div className="rounded-lg border bg-muted/30 p-2">
                                            <div className="text-xs text-muted-foreground">总计</div>
                                            <div className="text-sm font-medium">{result.usage.total_tokens}</div>
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
