'use client'

import { useEffect } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { ImagePreviewList } from '@/features/chat/welcome/ImagePreviewList'
import { useImageAttachments } from '@/features/chat/composer'
import { ChevronLeft, ImagePlus, Rocket, Settings, Zap } from 'lucide-react'
import type { BattleDraftImage, JudgeConfig, ModelConfigState } from '../hooks/useBattleFlow'

interface PromptStepProps {
    prompt: string
    expectedAnswer: string
    promptImages: BattleDraftImage[]
    expectedAnswerImages: BattleDraftImage[]
    selectedModels: ModelConfigState[]
    judgeConfig: JudgeConfig
    onPromptChange: (value: string) => void
    onExpectedAnswerChange: (value: string) => void
    onPromptImagesChange: (images: BattleDraftImage[]) => void
    onExpectedAnswerImagesChange: (images: BattleDraftImage[]) => void
    onBack: () => void
    onStart: () => void
    canStart: boolean
    isRunning: boolean
}

const isSameImages = (a: BattleDraftImage[], b: BattleDraftImage[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i]?.dataUrl !== b[i]?.dataUrl || a[i]?.mime !== b[i]?.mime || a[i]?.size !== b[i]?.size) {
            return false
        }
    }
    return true
}

export function PromptStep({
    prompt,
    expectedAnswer,
    promptImages,
    expectedAnswerImages,
    selectedModels,
    judgeConfig,
    onPromptChange,
    onExpectedAnswerChange,
    onPromptImagesChange,
    onExpectedAnswerImagesChange,
    onBack,
    onStart,
    canStart,
    isRunning,
}: PromptStepProps) {
    const { toast } = useToast()

    const promptAttachments = useImageAttachments({
        isVisionEnabled: true,
        limits: DEFAULT_CHAT_IMAGE_LIMITS,
        toast,
    })
    const expectedAnswerAttachments = useImageAttachments({
        isVisionEnabled: true,
        limits: DEFAULT_CHAT_IMAGE_LIMITS,
        toast,
    })

    useEffect(() => {
        if (!isSameImages(promptAttachments.selectedImages, promptImages)) {
            promptAttachments.setSelectedImages(promptImages)
        }
    }, [promptAttachments.selectedImages, promptAttachments.setSelectedImages, promptImages])

    useEffect(() => {
        if (!isSameImages(expectedAnswerAttachments.selectedImages, expectedAnswerImages)) {
            expectedAnswerAttachments.setSelectedImages(expectedAnswerImages)
        }
    }, [expectedAnswerAttachments.selectedImages, expectedAnswerAttachments.setSelectedImages, expectedAnswerImages])

    useEffect(() => {
        if (!isSameImages(promptAttachments.selectedImages, promptImages)) {
            onPromptImagesChange(promptAttachments.selectedImages)
        }
    }, [promptAttachments.selectedImages, promptImages, onPromptImagesChange])

    useEffect(() => {
        if (!isSameImages(expectedAnswerAttachments.selectedImages, expectedAnswerImages)) {
            onExpectedAnswerImagesChange(expectedAnswerAttachments.selectedImages)
        }
    }, [expectedAnswerAttachments.selectedImages, expectedAnswerImages, onExpectedAnswerImagesChange])

    return (
        <div className="space-y-6 w-full">
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                        📝 输入题目
                    </CardTitle>
                    <CardDescription>题目和答案都支持文本、图片、或文本+图片</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <Label>题目内容</Label>
                        <Textarea
                            value={prompt}
                            onChange={(e) => onPromptChange(e.target.value)}
                            onPaste={promptAttachments.handlePaste}
                            placeholder="输入要测试的问题，例如：请计算 1+1=?"
                            className="min-h-[140px] resize-none"
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={promptAttachments.pickImages}
                            >
                                <ImagePlus className="h-4 w-4" />
                                上传题目图片
                            </Button>
                            <span className="text-xs text-muted-foreground">最多 4 张图</span>
                        </div>
                        <ImagePreviewList
                            images={promptAttachments.selectedImages}
                            onRemove={promptAttachments.removeImage}
                        />
                        <input
                            ref={promptAttachments.fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={promptAttachments.onFilesSelected}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>期望答案</Label>
                        <Textarea
                            value={expectedAnswer}
                            onChange={(e) => onExpectedAnswerChange(e.target.value)}
                            onPaste={expectedAnswerAttachments.handlePaste}
                            placeholder="输入正确答案，裁判模型将根据此答案评判各模型输出"
                            className="min-h-[140px] resize-none"
                        />
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1"
                                onClick={expectedAnswerAttachments.pickImages}
                            >
                                <ImagePlus className="h-4 w-4" />
                                上传答案图片
                            </Button>
                            <span className="text-xs text-muted-foreground">最多 4 张图</span>
                        </div>
                        <ImagePreviewList
                            images={expectedAnswerAttachments.selectedImages}
                            onRemove={expectedAnswerAttachments.removeImage}
                        />
                        <input
                            ref={expectedAnswerAttachments.fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={expectedAnswerAttachments.onFilesSelected}
                        />
                    </div>
                </CardContent>
            </Card>

            <Card className="bg-muted/30">
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                        <Settings className="h-4 w-4" />
                        配置预览
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-muted-foreground">参赛模型:</span>
                        {selectedModels.map((item) => (
                            <Badge key={item.key} variant="secondary" className="text-xs">
                                {item.model.name}
                            </Badge>
                        ))}
                    </div>

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
