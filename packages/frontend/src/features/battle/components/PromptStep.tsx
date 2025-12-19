'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ChevronLeft, Rocket, Settings, Zap } from 'lucide-react'
import type { JudgeConfig, ModelConfigState } from '../hooks/useBattleFlow'

interface PromptStepProps {
    prompt: string
    expectedAnswer: string
    selectedModels: ModelConfigState[]
    judgeConfig: JudgeConfig
    onPromptChange: (value: string) => void
    onExpectedAnswerChange: (value: string) => void
    onBack: () => void
    onStart: () => void
    canStart: boolean
    isRunning: boolean
}

export function PromptStep({
    prompt,
    expectedAnswer,
    selectedModels,
    judgeConfig,
    onPromptChange,
    onExpectedAnswerChange,
    onBack,
    onStart,
    canStart,
    isRunning,
}: PromptStepProps) {
    return (
        <div className="space-y-6 max-w-3xl mx-auto">
            {/* Prompt Input */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        📝 输入题目
                    </CardTitle>
                    <CardDescription>所有参赛模型将接收相同的题目</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label>题目内容</Label>
                        <Textarea
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            placeholder="输入要测试的问题，例如：请计算 1+1=?"
                            className="min-h-[140px] resize-none"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>期望答案</Label>
                        <Textarea
                            value={expectedAnswer}
                            onChange={(e) => onExpectedAnswerChange(e.target.value)}
                            placeholder="输入正确答案，裁判模型将根据此答案评判各模型输出"
                            className="min-h-[140px] resize-none"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Config Preview */}
            <Card className="bg-muted/30">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                        <Settings className="h-4 w-4" />
                        配置预览
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    {/* Models */}
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">参赛模型:</span>
                        {selectedModels.map((item) => (
                            <Badge key={item.key} variant="secondary" className="text-xs">
                                {item.model.name}
                            </Badge>
                        ))}
                    </div>

                    {/* Judge & Settings */}
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                            <span>裁判:</span>
                            <span className="font-medium text-foreground">
                                {judgeConfig.model?.name || '未选择'}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>阈值:</span>
                            <span className="font-medium text-foreground">{judgeConfig.threshold}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>运行次数:</span>
                            <span className="font-medium text-foreground">{judgeConfig.runsPerModel}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>pass@k:</span>
                            <span className="font-medium text-foreground">{judgeConfig.passK}</span>
                        </div>
                        <div className="flex items-center gap-1">
                            <span>并发:</span>
                            <span className="font-medium text-foreground">{judgeConfig.maxConcurrency}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex items-center justify-between gap-4">
                <Button variant="outline" onClick={onBack} className="gap-2">
                    <ChevronLeft className="h-4 w-4" />
                    返回配置
                </Button>

                <Button
                    onClick={onStart}
                    disabled={!canStart || isRunning}
                    size="lg"
                    className="gap-2 min-w-[140px]"
                >
                    {isRunning ? (
                        <>
                            <Zap className="h-4 w-4 animate-pulse" />
                            准备中...
                        </>
                    ) : (
                        <>
                            <Rocket className="h-4 w-4" />
                            开始对战
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
