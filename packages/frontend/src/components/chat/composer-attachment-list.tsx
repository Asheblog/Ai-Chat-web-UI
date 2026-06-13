'use client'

import { AlertCircle, File, FileText, Loader2, Table, X } from 'lucide-react'
import type { WorkspaceFile } from '@/features/chat/composer'
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
  className?: string
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText className="h-4 w-4 text-blue-500" />
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <Table className="h-4 w-4 text-green-500" />
  return <File className="h-4 w-4 text-muted-foreground" />
}

/**
 * 输入区附件列表——输入框内展示图片缩略图和文件条目。
 */
export function ComposerAttachmentList({
  images,
  onRemoveImage,
  workspaceFiles,
  onRemoveWorkspaceFile,
  className,
}: ComposerAttachmentListProps) {
  if (images.length === 0 && workspaceFiles.length === 0) return null

  return (
    <div className={cn('mb-2 flex flex-wrap items-start gap-2', className)}>
      {images.map((img, idx) => (
        <div
          key={`${img.dataUrl}-${idx}`}
          className="relative inline-flex"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.dataUrl}
            alt={`预览图片 ${idx + 1}`}
            className="h-14 w-14 rounded-lg border border-border object-contain"
          />
          <button
            type="button"
            className="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            onClick={() => onRemoveImage(idx)}
            aria-label={`移除图片 ${idx + 1}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {workspaceFiles.map((file) => (
        <div
          key={file.localId}
          className={cn(
            'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm',
            file.status === 'error' && 'border-destructive/40 bg-destructive/5',
            file.status === 'uploading' && 'border-primary/30 bg-primary/[0.03]',
            file.status === 'ready' && 'border-border/70 bg-[hsl(var(--surface))/0.72]',
          )}
        >
          {file.status === 'uploading' ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : file.status === 'error' ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <span className="shrink-0">{getFileIcon(file.mimeType)}</span>
          )}

          <span className="max-w-[160px] truncate" title={file.originalName}>
            {file.originalName}
          </span>

          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatFileSize(file.fileSize)}
          </span>

          {file.status === 'error' && file.errorMessage && (
            <span className="shrink-0 text-[11px] text-destructive/80" title={file.errorMessage}>
              {file.errorMessage}
            </span>
          )}

          <button
            type="button"
            className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onRemoveWorkspaceFile(file.localId)}
            aria-label={`移除 ${file.originalName}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  )
}
