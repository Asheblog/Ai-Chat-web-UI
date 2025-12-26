'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { rejudgeWithNewAnswer } from '../api'
import { RefreshCw } from 'lucide-react'

interface RejudgeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentAnswer: string
  runId: number
  onComplete: () => void
}

export function RejudgeDialog({
  open,
  onOpenChange,
  currentAnswer,
  runId,
  onComplete,
}: RejudgeDialogProps) {
  const { toast } = useToast()
  const [newAnswer, setNewAnswer] = useState(currentAnswer)
  const [isRejudging, setIsRejudging] = useState(false)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // 当对话框打开时，重置状态
  useEffect(() => {
    if (open) {
      setNewAnswer(currentAnswer)
      setProgress(null)
      setIsRejudging(false)
    }
  }, [open, currentAnswer])

  const handleRejudge = useCallback(async () => {
    if (!runId || newAnswer.trim() === currentAnswer.trim()) return

    setIsRejudging(true)
    setProgress(null)
    abortControllerRef.current = new AbortController()

    try {
      for await (const event of rejudgeWithNewAnswer(
        runId,
        { expectedAnswer: newAnswer.trim() },
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
  }, [runId, newAnswer, currentAnswer, toast, onComplete, onOpenChange])

  const handleCancel = useCallback(() => {
    if (isRejudging && abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    onOpenChange(false)
  }, [isRejudging, onOpenChange])

  const progressPercent = progress && progress.total > 0 
    ? Math.round((progress.completed / progress.total) * 100) 
    : 0

  const canSubmit = newAnswer.trim() !== currentAnswer.trim() && newAnswer.trim().length > 0

  return (
    <Dialog open={open} onOpenChange={isRejudging ? undefined : onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>修正期望答案</DialogTitle>
          <DialogDescription>
            修改后将使用裁判模型重新评估所有模型输出，结果将覆盖原裁决并更新分享页面
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            disabled={isRejudging}
            rows={6}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
            placeholder="输入正确的期望答案..."
          />

          {/* 进度显示 */}
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