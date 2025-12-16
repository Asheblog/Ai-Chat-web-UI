import { Paperclip, ImagePlus, FilePlus2, FolderOpen, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  // 知识库相关
  onOpenKnowledgeBase?: () => void
  knowledgeBaseEnabled?: boolean
  knowledgeBaseCount?: number
}

/**
 * 统一的附件菜单按钮，展开后选择图片或文档上传。
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
  onOpenKnowledgeBase,
  knowledgeBaseEnabled,
  knowledgeBaseCount,
}: AttachmentMenuProps) {
  const hasAny = Boolean(hasImages || hasDocuments || (knowledgeBaseCount && knowledgeBaseCount > 0))

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            'h-12 w-12 rounded-full relative',
            hasAny && 'border-blue-300 text-blue-600 dark:text-blue-300',
            className,
          )}
          aria-label={ariaLabel}
        >
          <Paperclip className="h-5 w-5" />
          {typeof manageCount === 'number' && manageCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-medium text-white">
              {manageCount > 99 ? '99+' : manageCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onPickImages} disabled={disableImages}>
          <ImagePlus className="mr-2 h-4 w-4" />
          <span>图片上传</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onPickDocuments?.()}
          disabled={disableDocuments || !onPickDocuments}
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          <span>文档上传</span>
        </DropdownMenuItem>
        {onOpenManager && (
          <DropdownMenuItem
            onSelect={onOpenManager}
            disabled={manageDisabled}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            <span>附件管理{typeof manageCount === 'number' ? ` (${manageCount})` : ''}</span>
          </DropdownMenuItem>
        )}
        {knowledgeBaseEnabled && onOpenKnowledgeBase && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenKnowledgeBase}>
              <BookOpen className="mr-2 h-4 w-4" />
              <span>知识库{typeof knowledgeBaseCount === 'number' && knowledgeBaseCount > 0 ? ` (${knowledgeBaseCount})` : ''}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

