'use client'

import { useEffect, useRef } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { ImagePreviewList } from '@/features/chat/welcome/ImagePreviewList'
import { useImageAttachments } from '@/features/chat/composer'
import { ChevronLeft, ImagePlus, Rocket, Zap } from 'lucide-react'
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
    onStart: (payload?: { promptImages: BattleDraftImage[]; expectedAnswerImages: BattleDraftImage[] }) => void
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

const chipClass = 'inline-flex h-[26px] items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 text-[11.5px] text-muted-foreground'

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
    const prevPromptImagesRef = useRef<BattleDraftImage[]>(promptImages)
    const prevExpectedAnswerImagesRef = useRef<BattleDraftImage[]>(expectedAnswerImages)

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
    const {
        selectedImages: promptSelectedImages,
        setSelectedImages: setPromptSelectedImages,
    } = promptAttachments
    const {
        selectedImages: expectedSelectedImages,
        setSelectedImages: setExpectedSelectedImages,
    } = expectedAnswerAttachments

    useEffect(() => {
        if (prevPromptImagesRef.current === promptImages) {
            return
        }
        prevPromptImagesRef.current = promptImages
        if (!isSameImages(promptSelectedImages, promptImages)) {
            setPromptSelectedImages(promptImages)
        }
    }, [promptImages, promptSelectedImages, setPromptSelectedImages])

    useEffect(() => {
        if (prevExpectedAnswerImagesRef.current === expectedAnswerImages) {
            return
        }
        prevExpectedAnswerImagesRef.current = expectedAnswerImages
        if (!isSameImages(expectedSelectedImages, expectedAnswerImages)) {
            setExpectedSelectedImages(expectedAnswerImages)
        }
    }, [expectedAnswerImages, expectedSelectedImages, setExpectedSelectedImages])

    useEffect(() => {
        if (!isSameImages(promptSelectedImages, promptImages)) {
            onPromptImagesChange(promptSelectedImages)
        }
    }, [promptSelectedImages, promptImages, onPromptImagesChange])

    useEffect(() => {
        if (!isSameImages(expectedSelectedImages, expectedAnswerImages)) {
            onExpectedAnswerImagesChange(expectedSelectedImages)
        }
    }, [expectedSelectedImages, expectedAnswerImages, onExpectedAnswerImagesChange])

    const handleStart = () => {
        onStart({
            promptImages: promptSelectedImages,
            expectedAnswerImages: expectedSelectedImages,
        })
    }

    const uploadRow = (
        attachments: typeof promptAttachments,
        action: string,
        hint: string,
    ) => (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px] shadow-none"
                onClick={attachments.pickImages}
            >
                <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                {action}
            </Button>
            <span className="text-[11.5px] text-ink-tertiary">{hint}</span>
        </div>
    )

    return (
        <div className="w-full space-y-4">
            <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                <div className="mb-4 flex items-baseline justify-between gap-3">
                    <span className="text-[11px] font-medium tracking-[0.5px] text-ink-tertiary">题目</span>
                    <span className="text-[11.5px] text-ink-tertiary">题目和答案支持文本、图片或组合内容</span>
                </div>
                <Label htmlFor="battle-prompt" className="sr-only">题目内容</Label>
                <Textarea
                    id="battle-prompt"
                    value={prompt}
                    onChange={(e) => onPromptChange(e.target.value)}
                    onPaste={promptAttachments.handlePaste}
                    placeholder="输入要测试的问题，例如：请计算 1+1=?"
                    className="min-h-[132px] resize-none rounded-[10px] border-border bg-surface text-[14px] leading-[1.75] shadow-none"
                />
                <div className="mt-3 space-y-2">
                    {uploadRow(promptAttachments, '上传题目图片', '最多 4 张图')}
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
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className={chipClass}>配图 {promptSelectedImages.length}/4</span>
                    <span className={chipClass}>采样 {judgeConfig.runsPerModel} 次</span>
                    <span className={chipClass}>阈值 {judgeConfig.threshold}</span>
                    <span className="flex-1" />
                    <Button
                        onClick={handleStart}
                        disabled={!canStart || isRunning}
                        className="h-9 min-w-[120px] gap-2 rounded-[10px] bg-foreground px-4 text-[12.5px] font-medium text-background shadow-none hover:bg-foreground/90"
                    >
                        {isRunning ? (
                            <>
                                <Zap className="h-3.5 w-3.5 animate-pulse" aria-hidden />
                                准备中...
                            </>
                        ) : (
                            <>
                                <Rocket className="h-3.5 w-3.5" aria-hidden />
                                开始对战
                            </>
                        )}
                    </Button>
                </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
                <div className="mb-4 flex items-baseline justify-between gap-3">
                    <span className="text-[11px] font-medium tracking-[0.5px] text-ink-tertiary">期望答案</span>
                    <span className="text-[11.5px] text-ink-tertiary">裁判模型将按此答案评判各模型输出</span>
                </div>
                <Label htmlFor="battle-expected-answer" className="sr-only">期望答案</Label>
                <Textarea
                    id="battle-expected-answer"
                    value={expectedAnswer}
                    onChange={(e) => onExpectedAnswerChange(e.target.value)}
                    onPaste={expectedAnswerAttachments.handlePaste}
                    placeholder="输入正确答案，裁判模型将根据此答案评判各模型输出"
                    className="min-h-[120px] resize-none rounded-[10px] border-border bg-surface text-[14px] leading-[1.75] shadow-none"
                />
                <div className="mt-3 space-y-2">
                    {uploadRow(expectedAnswerAttachments, '上传答案图片', '最多 4 张图')}
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
            </section>

            <section className="rounded-xl border border-border bg-surface-subtle p-4">
                <div className="mb-2 text-[11px] font-medium tracking-[0.5px] text-ink-tertiary">配置预览</div>
                <div className="space-y-2 text-[12.5px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>参赛模型:</span>
                        {selectedModels.length === 0 ? (
                            <span className="text-ink-tertiary">未选择</span>
                        ) : (
                            selectedModels.map((item) => (
                                <span key={item.key} className="text-foreground">{item.model.name}</span>
                            ))
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 num-tabular">
                        <span>裁判: <span className="text-foreground">{judgeConfig.model?.name || '未选择'}</span></span>
                        <span>运行次数: <span className="text-foreground">{judgeConfig.runsPerModel}</span></span>
                        <span>pass@k: <span className="text-foreground">{judgeConfig.passK}</span></span>
                        <span>并发: <span className="text-foreground">{judgeConfig.maxConcurrency}</span></span>
                    </div>
                </div>
            </section>

            <div className="flex items-center justify-between gap-4">
                <Button
                    variant="outline"
                    onClick={onBack}
                    className="h-9 gap-1.5 rounded-[10px] px-3 text-[12.5px] shadow-none"
                >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    返回配置
                </Button>
                <span className="text-[11.5px] text-ink-tertiary">
                    {canStart ? '题目已就绪，可开始对战' : '请先填写题目内容'}
                </span>
            </div>
        </div>
    )
}
