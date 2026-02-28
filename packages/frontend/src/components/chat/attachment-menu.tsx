import { useState } from 'react'
import { BookOpen, FilePlus2, FolderOpen, ImagePlus, Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface AttachmentMenuProps {
  onPickImages: () => void
  onPickDocuments?: () => void
  disableImages?: boolean
  disableDocuments?: boolean
  hasImages?: boolean
  hasDocuments?: boolean
  onOpenManager?: () => void
  manageDisabled?: boolean
  manageCount?: number
  ariaLabel?: string
  className?: string
  menuMode?: 'dropdown' | 'sheet'
  // 知识库相关
  onOpenKnowledgeBase?: () => void
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
}

/**
 * 统一的附件菜单按钮，支持桌面下拉和移动端底部抽屉两种交互容器。
 */
export function AttachmentMenu({
  onPickImages,
  onPickDocuments,
  disableImages,
  disableDocuments,
  hasImages,
  hasDocuments,
  onOpenManager,
  manageDisabled,
  manageCount,
  ariaLabel = '添加附件',
  className,
  menuMode = 'dropdown',
  onOpenKnowledgeBase,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
}: AttachmentMenuProps) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const hasAny = Boolean(hasImages || hasDocuments || (knowledgeBaseCount && knowledgeBaseCount > 0))
  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn(
        'relative h-12 w-12 cursor-pointer rounded-2xl border-border/70 bg-[hsl(var(--surface))/0.75] text-muted-foreground transition-colors hover:bg-[hsl(var(--surface-hover))] focus-visible:ring-2 focus-visible:ring-ring/60',
        hasAny && 'border-primary/40 bg-primary/5 text-primary',
        className,
      )}
      aria-label={ariaLabel}
    >
      <Paperclip className="h-5 w-5" />
      {typeof manageCount === 'number' && manageCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {manageCount > 99 ? '99+' : manageCount}
        </span>
      )}
    </Button>
  )

  if (menuMode === 'sheet') {
    const closeAndRun = (action?: () => void) => {
      action?.()
      setSheetOpen(false)
    }

    return (
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          dialogTitle="附件操作"
          className="rounded-t-3xl border-border/80 bg-card/95 pb-[calc(env(safe-area-inset-bottom)+20px)]"
        >
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-base font-semibold text-foreground">附件与知识库</h3>
            <p className="mt-1 text-xs text-muted-foreground">上传文件、管理附件或切换知识库。</p>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-4 pb-2">
            <div className="space-y-2">
              <button
                type="button"
                className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.75] px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => closeAndRun(onPickImages)}
                disabled={disableImages}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ImagePlus className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">图片上传</span>
                  <span className="mt-1 block text-xs text-muted-foreground">支持多图上传，用于视觉模型分析。</span>
                </span>
              </button>

              <button
                type="button"
                className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.75] px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => closeAndRun(onPickDocuments)}
                disabled={disableDocuments || !onPickDocuments}
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <FilePlus2 className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">文档上传</span>
                  <span className="mt-1 block text-xs text-muted-foreground">上传文档后可在会话中引用内容。</span>
                </span>
              </button>

              {onOpenManager ? (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.75] px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--surface-hover))] disabled:cursor-not-allowed disabled:opacity-45"
                  onClick={() => closeAndRun(onOpenManager)}
                  disabled={manageDisabled}
                >
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      附件管理{typeof manageCount === 'number' ? ` (${manageCount})` : ''}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">查看上传进度、删除或批量管理附件。</span>
                  </span>
                </button>
              ) : null}

              {knowledgeBaseEnabled && onOpenKnowledgeBase ? (
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-[hsl(var(--surface))/0.75] px-3 py-3 text-left transition-colors hover:bg-[hsl(var(--surface-hover))]"
                  onClick={() => closeAndRun(onOpenKnowledgeBase)}
                >
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      知识库
                      {typeof knowledgeBaseCount === 'number' && knowledgeBaseCount > 0 ? ` (${knowledgeBaseCount})` : ''}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">选择会话可引用的知识库。</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56 rounded-2xl border-border/80 p-1.5">
        <DropdownMenuLabel className="px-2 py-1 text-xs font-medium text-muted-foreground">附件操作</DropdownMenuLabel>
        <DropdownMenuItem className="cursor-pointer" onSelect={onPickImages} disabled={disableImages}>
          <ImagePlus className="mr-2 h-4 w-4" />
          <span>图片上传</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => onPickDocuments?.()}
          disabled={disableDocuments || !onPickDocuments}
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          <span>文档上传</span>
        </DropdownMenuItem>
        {onOpenManager ? (
          <DropdownMenuItem className="cursor-pointer" onSelect={onOpenManager} disabled={manageDisabled}>
            <FolderOpen className="mr-2 h-4 w-4" />
            <span>附件管理{typeof manageCount === 'number' ? ` (${manageCount})` : ''}</span>
          </DropdownMenuItem>
        ) : null}
        {knowledgeBaseEnabled && onOpenKnowledgeBase ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onSelect={onOpenKnowledgeBase}>
              <BookOpen className="mr-2 h-4 w-4" />
              <span>
                知识库
                {typeof knowledgeBaseCount === 'number' && knowledgeBaseCount > 0 ? ` (${knowledgeBaseCount})` : ''}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
