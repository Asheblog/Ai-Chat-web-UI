"use client"
import { Dispatch, SetStateAction } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { ActorQuota } from "@/types"
import type { SystemUserRow } from "@/services/system-users"
import type { QuotaFormState } from "./use-system-users"

type UserQuotaDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: SystemUserRow | null
  snapshot: ActorQuota | null
  loading: boolean
  submitting: boolean
  error: string | null
  form: QuotaFormState
  setForm: Dispatch<SetStateAction<QuotaFormState>>
  onSave: () => void
}

export function UserQuotaDialog({
  open,
  onOpenChange,
  target,
  snapshot,
  loading,
  submitting,
  error,
  form,
  setForm,
  onSave,
}: UserQuotaDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>调整用户额度</DialogTitle>
          <DialogDescription>
            {target ? `用户：${target.username}` : '请选择用户'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-sm flex items-center justify-between">
              使用系统默认额度
              <Switch
                checked={form.useDefault}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, useDefault: checked }))}
                disabled={submitting}
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              默认额度来自「系统设置 · 通用」中的配额配置。
            </p>
          </div>
          {!form.useDefault && (
            <div className="space-y-2">
              <Label className="text-sm">自定义每日额度（次）</Label>
              <Input
                value={form.dailyLimit}
                onChange={(e) => setForm((prev) => ({ ...prev, dailyLimit: e.target.value }))}
                type="text"
                disabled={submitting}
              />
              <p className="text-xs text-muted-foreground">设置为 0 表示禁用该用户的调用权。</p>
            </div>
          )}
          {snapshot && (
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <div>当前每日额度：{snapshot.dailyLimit ?? '未设置'}</div>
              <div>今日已用：{snapshot.usedCount}</div>
              <div>剩余额度：{snapshot.remaining ?? '不限'}</div>
            </div>
          )}
          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-full" />
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-3">
            <Label className="text-sm">重置今日用量</Label>
            <Switch
              checked={form.resetUsed}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, resetUsed: checked }))}
              disabled={submitting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={
              submitting
              || loading
              || (!form.useDefault && !form.dailyLimit.trim())
            }
          >
            {submitting ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
