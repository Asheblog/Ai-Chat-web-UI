/**
 * 文档附件按钮和预览组件
 */

import React, { useState, useCallback } from 'react'
import { Paperclip, File, FileText, Table, X, Loader2, AlertCircle, Check, Ban, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetClose } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import type { AttachedDocument } from './use-document-attachments'
import { DOCUMENT_ACCEPT_TYPES } from './use-document-attachments'

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
      accept={DOCUMENT_ACCEPT_TYPES}
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
  return <File className="h-4 w-4 text-muted-foreground" />
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

function getStageText(stage?: string): string {
  switch (stage) {
    case 'parsing':
      return '解析中'
    case 'chunking':
      return '分块中'
    case 'embedding':
      return '生成向量中'
    case 'storing':
      return '写入中'
    case 'done':
      return '就绪'
    case 'error':
      return '失败'
    default:
      return ''
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
  onCancel?: () => void
  selected?: boolean
  onSelectChange?: (selected: boolean) => void
  showCheckbox?: boolean
}

const DocumentPreviewItem: React.FC<DocumentPreviewItemProps> = ({
  document,
  onRemove,
  onCancel,
  selected = false,
  onSelectChange,
  showCheckbox = false,
}) => {
  const stageText = getStageText(document.processingStage) || getStatusText(document.status)
  const progress = typeof document.processingProgress === 'number'
    ? Math.max(0, Math.min(100, document.processingProgress))
    : undefined
  const canCancel = (document.status === 'pending' || document.status === 'processing') && typeof onCancel === 'function'
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border px-3 py-2.5',
        'border-border/70 bg-[hsl(var(--surface))/0.72]',
        document.status === 'error' && 'border-red-300/80 bg-red-50/80 dark:bg-red-950/20',
        document.status === 'ready' && 'border-green-300/80 bg-green-50/80 dark:bg-green-950/20',
      )}
    >
      {showCheckbox && (
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelectChange?.(!!checked)}
        />
      )}
      {getFileIcon(document.mimeType)}

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={document.originalName}>
          {document.originalName}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatFileSize(document.fileSize)}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5">
            {getStatusIcon(document.status)}
            {progress != null ? `${stageText} ${progress}%` : stageText}
          </span>
          {document.errorMessage && (
            <span className="truncate text-red-500" title={document.errorMessage}>
              {document.errorMessage}
            </span>
          )}
        </div>
        {progress != null && (document.status === 'pending' || document.status === 'processing') && (
          <div className="mt-1 h-1.5 w-full rounded bg-muted">
            <div
              className="h-1.5 rounded bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
        onClick={canCancel ? onCancel : onRemove}
        title={canCancel ? '取消处理' : '移除'}
      >
        {canCancel ? <Ban className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </Button>
    </div>
  )
}

interface DocumentPreviewListProps {
  documents: AttachedDocument[]
  onRemove: (documentId: number) => void
  onCancel?: (documentId: number) => void
}

export const DocumentPreviewList: React.FC<DocumentPreviewListProps> = ({
  documents,
  onRemove,
  onCancel,
}) => {
  if (documents.length === 0) return null

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 p-2">
      {documents.map((doc) => (
        <DocumentPreviewItem
          key={doc.id}
          document={doc}
          onRemove={() => onRemove(doc.id)}
          onCancel={onCancel ? () => onCancel(doc.id) : undefined}
        />
      ))}
    </div>
  )
}

interface AttachmentTrayProps {
  documents: AttachedDocument[]
  onRemove: (documentId: number) => void
  onBatchRemove?: (documentIds: number[]) => void
  onCancel?: (documentId: number) => void
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
  onBatchRemove,
  onCancel,
  open,
  onOpenChange,
  title = '附件管理',
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [batchMode, setBatchMode] = useState(false)

  const toggleSelect = useCallback((id: number, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === documents.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(documents.map(d => d.id)))
    }
  }, [documents, selectedIds.size])

  const handleBatchRemove = useCallback(() => {
    if (selectedIds.size === 0) return
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个文档吗？`)) return

    if (onBatchRemove) {
      onBatchRemove(Array.from(selectedIds))
    } else {
      // 如果没有批量删除回调，逐个删除
      selectedIds.forEach(id => onRemove(id))
    }
    setSelectedIds(new Set())
    setBatchMode(false)
  }, [selectedIds, onBatchRemove, onRemove])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedIds(new Set())
  }, [])

  if (documents.length === 0) return null

  return (
    <Sheet open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        exitBatchMode()
      }
      onOpenChange(isOpen)
    }}>
      <SheetContent
        side="bottom"
        showCloseButton
        dialogTitle={title}
        className="flex max-h-[72vh] flex-col rounded-t-3xl border-border/80 bg-card/95"
      >
        <div className="flex min-h-0 flex-col space-y-3 p-4">
          <div className="flex shrink-0 items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">查看文档状态并执行删除或批量管理。</p>
            </div>
            <div className="flex items-center gap-2">
              {batchMode ? (
                <>
                  <Button variant="outline" size="sm" onClick={exitBatchMode}>
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBatchRemove}
                    disabled={selectedIds.size === 0}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    删除 ({selectedIds.size})
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setBatchMode(true)}>
                  批量管理
                </Button>
              )}
            </div>
          </div>

          {batchMode && (
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <Checkbox
                checked={selectedIds.size === documents.length && documents.length > 0}
                onCheckedChange={toggleSelectAll}
              />
              <span className="text-sm text-muted-foreground">
                {selectedIds.size > 0 ? `已选择 ${selectedIds.size} 项` : '全选'}
              </span>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col gap-2 p-2">
              {documents.map((doc) => (
                <DocumentPreviewItem
                  key={doc.id}
                  document={doc}
                  onRemove={() => onRemove(doc.id)}
                  onCancel={onCancel ? () => onCancel(doc.id) : undefined}
                  showCheckbox={batchMode}
                  selected={selectedIds.has(doc.id)}
                  onSelectChange={(selected) => toggleSelect(doc.id, selected)}
                />
              ))}
            </div>
          </div>

          <div className="flex shrink-0 justify-end">
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
