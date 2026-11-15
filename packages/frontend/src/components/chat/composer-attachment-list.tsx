'use client'

import { AlertCircle, File, FileText, Loader2, RotateCw, Table, X } from 'lucide-react'
import type { WorkspaceFile } from '@/features/chat/composer'
import { formatFileSize } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ComposerImage {
  dataUrl: string
  mime: string
  size: number
}

interface ComposerAttachmentListProps {
  images: ComposerImage[]
  onRemoveImage: (index: number) => void
  workspaceFiles: WorkspaceFile[]
  onRemoveWorkspaceFile: (localId: string) => void
  /** 失败文件的重试动作；由上层接到既有上传链路，缺省时不渲染重试。 */
  onRetryWorkspaceFile?: (localId: string) => void
  className?: string
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText className="h-4 w-4 text-blue-500" />
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <Table className="h-4 w-4 text-green-500" />
  return <File className="h-4 w-4 text-muted-foreground" />
}

/** 移除/重试的命中区：手机 44px，桌面回到紧凑尺寸，视觉圆点保持小尺寸。 */
const touchTargetClass = 'inline-flex h-11 w-11 shrink-0 items-center justify-center md:h-6 md:w-6'

/**
 * 输入区附件列表——输入框内展示图片缩略图和文件条目。
 * 失败文件提供重试与移除，重试沿用上层既有上传链路。
 */
export function ComposerAttachmentList({
  images,
  onRemoveImage,
  workspaceFiles,
  onRemoveWorkspaceFile,
  onRetryWorkspaceFile,
  className,
}: ComposerAttachmentListProps) {
  if (images.length === 0 && workspaceFiles.length === 0) return null

  return (
    <div
      data-composer-layer="attachments"
      className={cn('flex flex-wrap items-start gap-2', className)}
    >
      {images.map((img, idx) => (
        <div
          key={img.dataUrl + '-' + idx}
          className="relative inline-flex"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.dataUrl}
            alt={'预览图片 ' + (idx + 1)}
            className="h-14 w-14 rounded-lg border border-border object-contain"
          />
          <button
            type="button"
            className={cn(touchTargetClass, 'absolute -right-3 -top-3 rounded-full')}
            onClick={() => onRemoveImage(idx)}
            aria-label={'移除图片 ' + (idx + 1)}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground">
              <X className="h-3 w-3" aria-hidden="true" />
            </span>
          </button>
        </div>
      ))}

      {workspaceFiles.map((file) => (
        <div
          key={file.localId}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm',
            file.status === 'error' && 'border-destructive/40 bg-destructive/5',
            file.status === 'uploading' && 'border-signal/30 bg-signal-soft/40',
            file.status === 'ready' && 'border-border bg-[hsl(var(--surface))/0.72]',
          )}
        >
          {file.status === 'uploading' ? (
            <Loader2 className="h-4 w-4 animate-spin text-signal" />
          ) : file.status === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <span className="shrink-0">{getFileIcon(file.mimeType)}</span>
          )}

          <span className="max-w-[160px] truncate" title={file.originalName}>
            {file.originalName}
          </span>

          <span className="shrink-0 text-[11px] text-muted-foreground">
            {file.status === 'error' ? '上传失败' : formatFileSize(file.fileSize)}
          </span>

          {file.status === 'error' && file.errorMessage && (
            <span className="shrink-0 text-[11px] text-destructive/80" title={file.errorMessage}>
              {file.errorMessage}
            </span>
          )}

          {file.status === 'error' && onRetryWorkspaceFile ? (
            <button
              type="button"
              className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-destructive transition-colors hover:bg-destructive/10 md:min-h-8"
              onClick={() => onRetryWorkspaceFile(file.localId)}
              aria-label={'重试 ' + file.originalName}
            >
              <RotateCw className="h-3 w-3" aria-hidden="true" />
              重试
            </button>
          ) : null}

          <button
            type="button"
            className={cn(touchTargetClass, 'rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive')}
            onClick={() => onRemoveWorkspaceFile(file.localId)}
            aria-label={'移除 ' + file.originalName}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
