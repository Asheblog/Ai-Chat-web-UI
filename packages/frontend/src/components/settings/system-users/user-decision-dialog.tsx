"use client"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { DecisionDialogState } from "./use-system-users"

type UserDecisionDialogProps = {
  state: DecisionDialogState
  onClose: () => void
  onChangeReason: (value: string) => void
  onSubmit: () => void
}

export function UserDecisionDialog({
  state,
  onClose,
  onChangeReason,
  onSubmit,
}: UserDecisionDialogProps) {
  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.mode === 'REJECT' ? '拒绝注册申请' : '禁用用户'}</DialogTitle>
          <DialogDescription>
            {state.target ? `用户：${state.target.username}` : '请选择用户'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {state.error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
              {state.error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="decisionReason" className="text-sm">
              {state.mode === 'REJECT' ? '拒绝理由（可选）' : '禁用理由（可选）'}
            </Label>
            <Textarea
              id="decisionReason"
              value={state.reason}
              onChange={(e) => onChangeReason(e.target.value)}
              placeholder={state.mode === 'REJECT' ? '说明拒绝原因，便于用户了解情况' : '可记录禁用原因，便于后续审计'}
              disabled={state.submitting}
              maxLength={200}
              rows={4}
            />
            <p className="text-xs text-muted-foreground">最多 200 字，可留空。</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={state.submitting}>
            取消
          </Button>
          <Button type="button" onClick={onSubmit} disabled={state.submitting}>
            {state.submitting ? '处理中...' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
