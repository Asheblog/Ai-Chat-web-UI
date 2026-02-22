"use client"

import * as React from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type DestructiveConfirmDialogContentProps = {
  title: React.ReactNode
  description: React.ReactNode
  warning?: React.ReactNode
  cancelLabel?: React.ReactNode
  actionLabel: React.ReactNode
  actionDisabled?: boolean
  cancelDisabled?: boolean
  onAction?: (event: React.MouseEvent<HTMLButtonElement>) => void
  contentClassName?: string
  actionClassName?: string
  cancelClassName?: string
}

export function DestructiveConfirmDialogContent({
  title,
  description,
  warning,
  cancelLabel = "取消",
  actionLabel,
  actionDisabled = false,
  cancelDisabled = false,
  onAction,
  contentClassName,
  actionClassName,
  cancelClassName,
}: DestructiveConfirmDialogContentProps) {
  return (
    <AlertDialogContent className={cn("max-w-[560px] overflow-hidden border-destructive/25 p-0", contentClassName)}>
      <div className="bg-[linear-gradient(180deg,hsl(var(--destructive)/0.14)_0%,hsl(var(--card))_82%)] px-6 pb-5 pt-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full border border-destructive/35 bg-destructive/12 p-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <AlertDialogHeader className="space-y-2 text-left">
            <AlertDialogTitle className="text-xl">{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-[15px] leading-6 text-muted-foreground">
              {description}
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        {warning ? (
          <div className="mt-4 rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {warning}
          </div>
        ) : null}
      </div>
      <AlertDialogFooter className="bg-[hsl(var(--surface))/0.7] px-6 py-4 sm:space-x-3">
        <AlertDialogCancel disabled={cancelDisabled} className={cn("min-w-[96px]", cancelClassName)}>
          {cancelLabel}
        </AlertDialogCancel>
        <AlertDialogAction
          onClick={onAction}
          disabled={actionDisabled}
          className={cn(
            "min-w-[112px] bg-destructive text-destructive-foreground shadow-[0_10px_24px_hsl(var(--destructive)/0.33)] hover:bg-destructive/90",
            actionClassName,
          )}
        >
          {actionLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

