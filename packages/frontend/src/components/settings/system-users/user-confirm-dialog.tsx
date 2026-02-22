"use client"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { DestructiveConfirmDialogContent } from "@/components/ui/destructive-confirm-dialog"
import type { ConfirmDialogState } from "./use-system-users"

type ConfirmMeta = {
  title: string
  description: string
  action: string
}

type UserConfirmDialogProps = {
  state: ConfirmDialogState
  meta: ConfirmMeta | null
  loading: boolean
  onConfirm: () => void
  onClose: () => void
}

export function UserConfirmDialog({
  state,
  meta,
  loading,
  onConfirm,
  onClose,
}: UserConfirmDialogProps) {
  if (!meta) return null
  const isDeleteMode = state.mode === 'DELETE'

  return (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      {isDeleteMode ? (
        <DestructiveConfirmDialogContent
          title={meta.title}
          description={meta.description}
          warning="删除后会级联清理关联数据，且无法恢复。"
          cancelLabel="取消"
          actionLabel={loading ? '执行中…' : meta.action}
          actionDisabled={loading}
          cancelDisabled={loading}
          onAction={(event) => {
            event.preventDefault()
            onConfirm()
          }}
        />
      ) : (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{meta.title}</AlertDialogTitle>
            <AlertDialogDescription>{meta.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={loading}>
              {loading ? '执行中…' : meta.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  )
}
