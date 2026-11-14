'use client'

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import type { ProcessLayoutMode } from '../hooks/use-process-layout-mode'

/**
 * 覆盖 / 全屏抽屉：Radix Sheet（= Dialog）负责焦点锁定、Esc 关闭与还焦点。
 * 没有宿主时 Entry 用它开本地抽屉，分享、Battle 与任意独立调用点都不需要宿主。
 */
export function ProcessDrawer({
  open,
  mode,
  title,
  onClose,
  children,
}: {
  open: boolean
  mode: ProcessLayoutMode
  title: string
  onClose: () => void
  children: ReactNode
}) {
  if (!open) return null
  return (
    <Sheet open onOpenChange={(next) => { if (!next) onClose() }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        dialogTitle={title}
        dialogDescription="本轮工具调用、来源与产物的过程工作区"
        className={cn(
          'flex h-full min-h-0 flex-col p-0',
          mode === 'fullscreen'
            ? 'w-full max-w-none border-l-0'
            : 'w-full sm:w-[440px] sm:max-w-[calc(100vw-2rem)]',
        )}
      >
        {children}
      </SheetContent>
    </Sheet>
  )
}
