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

  return (
    <AlertDialog open={state.open} onOpenChange={(open) => { if (!open) onClose() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{meta.title}</AlertDialogTitle>
          <AlertDialogDescription>{meta.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className={state.mode === 'DELETE' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {loading ? '执行中…' : meta.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
