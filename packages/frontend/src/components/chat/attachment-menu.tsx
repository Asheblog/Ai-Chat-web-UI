import { Paperclip, ImagePlus, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  ariaLabel?: string
  className?: string
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
  ariaLabel = '添加附件',
  className,
}: AttachmentMenuProps) {
  const hasAny = Boolean(hasImages || hasDocuments)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(
            'h-12 w-12 rounded-full',
            hasAny && 'border-blue-300 text-blue-600 dark:text-blue-300',
            className,
          )}
          aria-label={ariaLabel}
        >
          <Paperclip className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
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
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
