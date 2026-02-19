'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { DEFAULT_CHAT_IMAGE_LIMITS } from '@aichat/shared/image-limits'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ModelSelector } from '@/components/model-selector'
import { useToast } from '@/components/ui/use-toast'
import { rejudgeWithNewAnswer } from '../api'
import { RefreshCw, X } from 'lucide-react'
import type { ModelItem } from '@/store/models-store'
import { useModelsStore } from '@/store/models-store'
import { ImagePreviewList } from '@/features/chat/welcome/ImagePreviewList'
import { useImageAttachments } from '@/features/chat/composer'

interface RejudgeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAnswer: {
    text: string
    images: string[]
  }
  runId: number
  currentJudge: {
    modelId: string
    connectionId?: number | null
    rawId?: string | null
    threshold?: number
  }
  onComplete: () => void
}

const toUploadImages = (images: Array<{ dataUrl: string; mime: string }>) => {
  return images
    .map((item) => ({
      data: item.dataUrl.split(',')[1] || '',
      mime: item.mime,
    }))
    .filter((item) => item.data && item.mime)
}

const sameImageList = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function RejudgeDialog({
  open,
  onOpenChange,
  currentAnswer,
  runId,
  currentJudge,
  onComplete,
}: RejudgeDialogProps) {
  const { toast } = useToast()
  const { models } = useModelsStore()
  const [newAnswer, setNewAnswer] = useState(currentAnswer.text)
  const [keepImages, setKeepImages] = useState<string[]>(currentAnswer.images)
  const [isRejudging, setIsRejudging] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [judgeRef, setJudgeRef] = useState<{
    modelId: string
    connectionId?: number | null
    rawId?: string | null
  }>({
    modelId: currentJudge.modelId,
    connectionId: currentJudge.connectionId ?? null,
    rawId: currentJudge.rawId ?? null,
  })
  const [judgeThreshold, setJudgeThreshold] = useState<number>(currentJudge.threshold ?? 0.8)
  const abortControllerRef = useRef<AbortController | null>(null)

  const newImages = useImageAttachments({
    isVisionEnabled: true,
    limits: DEFAULT_CHAT_IMAGE_LIMITS,
    toast,
  })

  useEffect(() => {
    if (open) {
      setNewAnswer(currentAnswer.text)
      setKeepImages(currentAnswer.images)
      newImages.setSelectedImages([])
      setProgress(null)
      setIsRejudging(false)
      setJudgeRef({
        modelId: currentJudge.modelId,
        connectionId: currentJudge.connectionId ?? null,
        rawId: currentJudge.rawId ?? null,
      })
      setJudgeThreshold(currentJudge.threshold ?? 0.8)
    }
  }, [
    open,
    currentAnswer.text,
    currentAnswer.images,
    currentJudge.modelId,
    currentJudge.connectionId,
    currentJudge.rawId,
    currentJudge.threshold,
    newImages.setSelectedImages,
  ])

  const selectedModelId = useMemo(() => {
    if (judgeRef.connectionId != null && judgeRef.rawId) {
      return `${judgeRef.connectionId}:${judgeRef.rawId}`
    }
    return judgeRef.rawId || judgeRef.modelId
  }, [judgeRef])

  const selectedJudgeModel = useMemo(() => {
    if (judgeRef.connectionId != null && judgeRef.rawId) {
      return models.find((item) => item.connectionId === judgeRef.connectionId && item.rawId === judgeRef.rawId) || null
    }
    return models.find((item) => item.id === judgeRef.modelId) || null
  }, [models, judgeRef])

  const judgeVisionCapable = selectedJudgeModel?.capabilities?.vision === true

  const nextHasImages = keepImages.length > 0 || newImages.selectedImages.length > 0
  const nextImageCount = keepImages.length + newImages.selectedImages.length
  const nextHasContent = newAnswer.trim().length > 0 || nextHasImages
  const isTextChanged = newAnswer.trim() !== currentAnswer.text.trim()
  const isKeepImagesChanged = !sameImageList(keepImages, currentAnswer.images)
  const hasNewImages = newImages.selectedImages.length > 0

  const canSubmit = nextHasContent && Boolean(judgeRef.modelId) && (isTextChanged || isKeepImagesChanged || hasNewImages)

  const handleRejudge = useCallback(async () => {
    if (!runId || !canSubmit) return

    if (nextHasImages && !judgeVisionCapable) {
      toast({ title: '答案包含图片时，裁判模型必须支持 Vision', variant: 'destructive' })
      return
    }
    if (nextImageCount > 4) {
      toast({ title: '答案图片最多 4 张（保留+新增）', variant: 'destructive' })
      return
    }

    setIsRejudging(true)
    setProgress(null)
    abortControllerRef.current = new AbortController()

    try {
      for await (const event of rejudgeWithNewAnswer(
        runId,
        {
          expectedAnswer: {
            ...(newAnswer.trim() ? { text: newAnswer.trim() } : {}),
            ...(keepImages.length > 0 ? { keepImages } : {}),
            ...(newImages.selectedImages.length > 0 ? { newImages: toUploadImages(newImages.selectedImages) } : {}),
          },
          judge: judgeRef.modelId
            ? {
              modelId: judgeRef.modelId,
              connectionId: judgeRef.connectionId ?? undefined,
              rawId: judgeRef.rawId ?? undefined,
            }
            : undefined,
          judgeThreshold,
        },
        { signal: abortControllerRef.current.signal },
      )) {
        if (event.type === 'rejudge_start') {
          setProgress({ completed: 0, total: event.payload?.total ?? 0 })
        } else if (event.type === 'rejudge_progress') {
          setProgress({
            completed: event.payload?.completed ?? 0,
            total: event.payload?.total ?? 0,
          })
        } else if (event.type === 'rejudge_complete') {
          toast({ title: '重新裁决完成' })
          onComplete()
          onOpenChange(false)
        } else if (event.type === 'error') {
          toast({ title: event.error || '重新裁决失败', variant: 'destructive' })
        }
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        toast({ title: error?.message || '重新裁决失败', variant: 'destructive' })
      }
    } finally {
      setIsRejudging(false)
      setProgress(null)
      abortControllerRef.current = null
    }
  }, [
    runId,
    canSubmit,
    nextHasImages,
    nextImageCount,
    judgeVisionCapable,
    toast,
    newAnswer,
    keepImages,
    newImages.selectedImages,
    judgeRef,
    judgeThreshold,
    onComplete,
    onOpenChange,
  ])

  const handleCancel = useCallback(() => {
    if (isRejudging && abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    onOpenChange(false)
  }, [isRejudging, onOpenChange])

  const progressPercent = progress && progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <Dialog open={open} onOpenChange={isRejudging ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>修正期望答案</DialogTitle>
          <DialogDescription>
            修改后将使用裁判模型重新评估所有模型输出，结果将覆盖原裁决并更新分享页面
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>裁判模型</Label>
            <ModelSelector
              selectedModelId={selectedModelId}
              onModelChange={(model: ModelItem) => setJudgeRef({
                modelId: model.id,
                connectionId: model.connectionId ?? null,
                rawId: model.rawId ?? null,
              })}
              disabled={isRejudging}
              className="w-full justify-between"
            />
          </div>

          <div className="space-y-2">
            <Label>裁判阈值</Label>
            <Input
              type="text"
              value={judgeThreshold}
              disabled={isRejudging}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value)
                setJudgeThreshold(Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.8)
              }}
            />
          </div>

          <div className="space-y-2">
            <Label>答案文本</Label>
            <textarea
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              onPaste={newImages.handlePaste}
              disabled={isRejudging}
              rows={6}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
              placeholder="输入正确的期望答案（可留空，仅用图片）..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>保留原有图片</Label>
              {keepImages.length > 0 && (
                <span className="text-xs text-muted-foreground">{keepImages.length} 张</span>
              )}
            </div>
            {keepImages.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {keepImages.map((url, index) => (
                  <div key={`${url}-${index}`} className="relative rounded border overflow-hidden">
                    <img src={url} alt={`保留图片 ${index + 1}`} className="h-20 w-full object-contain bg-background" />
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded-full border bg-background p-1"
                      onClick={() => setKeepImages((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">无保留图片</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={newImages.pickImages} disabled={isRejudging}>
                新增答案图片
              </Button>
              <span className="text-xs text-muted-foreground">最多 4 张（保留+新增）</span>
            </div>
            <ImagePreviewList images={newImages.selectedImages} onRemove={newImages.removeImage} />
            <input
              ref={newImages.fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={newImages.onFilesSelected}
              disabled={isRejudging}
            />
          </div>

          {progress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  正在裁决...
                </span>
                <span>
                  {progress.completed}/{progress.total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={false}
          >
            {isRejudging ? '取消' : '关闭'}
          </Button>
          <Button
            onClick={handleRejudge}
            disabled={isRejudging || !canSubmit}
          >
            {isRejudging ? '裁决中...' : '确认并重新裁决'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
