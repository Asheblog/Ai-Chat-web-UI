'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ExpandEditorDialogProps {
  open: boolean
  draft: string
  onDraftChange: (value: string) => void
  onClose: () => void
  onApply: () => void
}

export function ExpandEditorDialog({ open, draft, onDraftChange, onClose, onApply }: ExpandEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-w-[1000px] w-[92vw] h-[80vh] max-h-[85vh] p-0 rounded-2xl sm:rounded-3xl overflow-hidden flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>编辑消息</DialogTitle>
          <DialogDescription>使用全屏编辑框调整待发送内容</DialogDescription>
        </DialogHeader>
        <div className="p-4 border-b rounded-t-2xl text-sm text-muted-foreground">编辑消息</div>
        <div className="flex-1 min-h-0 p-4">
          <Textarea value={draft} onChange={(e) => onDraftChange(e.target.value)} className="h-full w-full resize-none border rounded-md p-3" />
        </div>
        <div className="p-4 border-t rounded-b-2xl flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={onApply}>应用</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
