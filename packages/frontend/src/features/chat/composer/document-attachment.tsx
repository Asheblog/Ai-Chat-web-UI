/**
 * 文档附件按钮和预览组件
 */

import React, { useMemo } from 'react'
import { Paperclip, File, FileText, Table, X, Loader2, AlertCircle, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { AttachedDocument } from './use-document-attachments'

interface DocumentAttachmentButtonProps {
  onClick: () => void
  disabled?: boolean
  hasDocuments?: boolean
}

export const DocumentAttachmentButton: React.FC<DocumentAttachmentButtonProps> = ({
  onClick,
  disabled,
  hasDocuments,
}) => {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-8 w-8 rounded-full',
        hasDocuments && 'text-blue-500 hover:text-blue-600'
      )}
      title="添加文档"
    >
      <Paperclip className="h-4 w-4" />
    </Button>
  )
}

interface DocumentAttachmentInputProps {
  inputRef: React.RefObject<HTMLInputElement>
  onFilesSelected: (event: React.ChangeEvent<HTMLInputElement>) => void
}

export const DocumentAttachmentInput: React.FC<DocumentAttachmentInputProps> = ({
  inputRef,
  onFilesSelected,
}) => {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".pdf,.docx,.doc,.csv,.txt,.md"
      multiple
      className="hidden"
      onChange={onFilesSelected}
    />
  )
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) {
    return <FileText className="h-4 w-4 text-red-500" />
  }
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return <FileText className="h-4 w-4 text-blue-500" />
  }
  if (mimeType.includes('csv')) {
    return <Table className="h-4 w-4 text-green-500" />
  }
  return <File className="h-4 w-4 text-gray-500" />
}

function getStatusIcon(status: AttachedDocument['status']) {
  switch (status) {
    case 'uploading':
    case 'pending':
    case 'processing':
      return <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
    case 'ready':
      return <Check className="h-3 w-3 text-green-500" />
    case 'error':
      return <AlertCircle className="h-3 w-3 text-red-500" />
  }
}

function getStatusText(status: AttachedDocument['status']) {
  switch (status) {
    case 'uploading':
      return '上传中...'
    case 'pending':
      return '等待处理...'
    case 'processing':
      return '解析中...'
    case 'ready':
      return '就绪'
    case 'error':
      return '失败'
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface DocumentPreviewItemProps {
  document: AttachedDocument
  onRemove: () => void
}

const DocumentPreviewItem: React.FC<DocumentPreviewItemProps> = ({
  document,
  onRemove,
}) => {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-lg border',
        'bg-muted/50',
        document.status === 'error' && 'border-red-300 bg-red-50 dark:bg-red-950/20',
        document.status === 'ready' && 'border-green-300 bg-green-50 dark:bg-green-950/20'
      )}
    >
      {getFileIcon(document.mimeType)}

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={document.originalName}>
          {document.originalName}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatFileSize(document.fileSize)}</span>
          <span className="flex items-center gap-1">
            {getStatusIcon(document.status)}
            {getStatusText(document.status)}
          </span>
          {document.errorMessage && (
            <span className="text-red-500 truncate" title={document.errorMessage}>
              {document.errorMessage}
            </span>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
        onClick={onRemove}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}

interface DocumentPreviewListProps {
  documents: AttachedDocument[]
  onRemove: (documentId: number) => void
}

export const DocumentPreviewList: React.FC<DocumentPreviewListProps> = ({
  documents,
  onRemove,
}) => {
  if (documents.length === 0) return null

  return (
    <div className="flex flex-col gap-2 p-2 border-t">
      {documents.map((doc) => (
        <DocumentPreviewItem
          key={doc.id}
          document={doc}
          onRemove={() => onRemove(doc.id)}
        />
      ))}
    </div>
  )
}

interface AttachmentTrayProps {
  documents: AttachedDocument[]
  onRemove: (documentId: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

/**
 * 附件收纳条：默认占一行，点击查看/管理附件，减少占位。
 */
export const AttachmentTray: React.FC<AttachmentTrayProps> = ({
  documents,
  onRemove,
  open,
  onOpenChange,
  title = '附件管理',
}) => {
  const summary = useMemo(() => {
    const names = documents.slice(0, 2).map((d) => d.originalName)
    const rest = Math.max(0, documents.length - 2)
    return { names, rest }
  }, [documents])

  if (documents.length === 0) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" showCloseButton>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">{title}</div>
            <span className="text-xs text-muted-foreground">
              {documents.length} 个
              {summary.names.length > 0 && (
                <span className="ml-2 hidden sm:inline">
                  {summary.names.join('、')}
                  {summary.rest > 0 ? ` +${summary.rest}` : ''}
                </span>
              )}
            </span>
          </div>
          <DocumentPreviewList documents={documents} onRemove={onRemove} />
          <div className="flex justify-end">
            <SheetClose asChild>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
            </SheetClose>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
