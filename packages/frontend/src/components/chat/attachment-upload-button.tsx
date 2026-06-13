'use client'

import { Paperclip } from 'lucide-react'
import { RECOMMENDED_FILE_TYPES, FILE_SIZE_LIMIT_LABEL } from '@aichat/shared/workspace-files'
import { cn } from '@/lib/utils'
import { composerToolbarButtonClass } from './composer-toolbar-primitives'

const TOOLTIP_TEXT = `附件上传：图片、${RECOMMENDED_FILE_TYPES.slice(0, 4).join('、')}、文本/代码 · ${FILE_SIZE_LIMIT_LABEL}`

interface AttachmentUploadButtonProps {
  onPick: () => void
  disabled?: boolean
  hasAttachments?: boolean
  count?: number
  className?: string
  ariaLabel?: string
}

/**
 * 附件上传按钮——纯图标按钮，点击直接触发文件选择器。
 * 不再弹出 dropdown/sheet 菜单。
 * hover 时显示支持的文件类型提示。
 */
export function AttachmentUploadButton({
  onPick,
  disabled,
  hasAttachments,
  count,
  className,
  ariaLabel = '上传附件',
}: AttachmentUploadButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        composerToolbarButtonClass,
        hasAttachments && 'border-primary/35 bg-primary/5 text-primary',
        className,
      )}
      onClick={onPick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={TOOLTIP_TEXT}
    >
      <Paperclip className="h-4 w-4" />
      {typeof count === 'number' && count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}
