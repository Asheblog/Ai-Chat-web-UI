/**
 * 文档附件按钮和预览组件
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Ban, Check, File, FileText, Loader2, Paperclip, Search, Table, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
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

function isActiveStatus(status: AttachedDocument['status']) {
  return status === 'uploading' || status === 'pending' || status === 'processing'
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

function getStatusTone(status: AttachedDocument['status']) {
  switch (status) {
    case 'uploading':
    case 'pending':
    case 'processing':
      return 'border-blue-200/80 bg-blue-50/85 text-blue-700 dark:border-blue-800/60 dark:bg-blue-950/30 dark:text-blue-300'
    case 'ready':
      return 'border-emerald-200/80 bg-emerald-50/85 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300'
    case 'error':
      return 'border-red-200/80 bg-red-50/85 text-red-700 dark:border-red-800/60 dark:bg-red-950/30 dark:text-red-300'
  }
}

interface DocumentPreviewItemProps {
  document: AttachedDocument
  onRemove: () => void
  onCancel?: () => void
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (selected: boolean) => void
}

const DocumentPreviewItem: React.FC<DocumentPreviewItemProps> = ({
  document,
  onRemove,
  onCancel,
  selectable = false,
  selected = false,
  onSelectChange,
}) => {
  const stageText = getStageText(document.processingStage) || getStatusText(document.status)
  const progress = typeof document.processingProgress === 'number'
    ? Math.max(0, Math.min(100, document.processingProgress))
    : undefined
  const canCancel = (document.status === 'pending' || document.status === 'processing') && typeof onCancel === 'function'
  return (
    <article
      className={cn(
        'rounded-2xl border px-3 py-3 md:px-4',
        'bg-[hsl(var(--surface))/0.72] transition-colors',
        selected && 'border-primary/45 ring-2 ring-primary/20',
        !selected && 'border-border/70 hover:bg-[hsl(var(--surface-hover))]',
      )}
    >
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectChange?.(checked === true)}
            className="mt-1"
          />
        ) : null}

        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {getFileIcon(document.mimeType)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground" title={document.originalName}>
                {document.originalName}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatFileSize(document.fileSize)}
              </p>
            </div>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                getStatusTone(document.status),
              )}
            >
              {getStatusIcon(document.status)}
              {progress != null ? `${stageText} ${progress}%` : stageText}
            </span>
          </div>

          {progress != null && isActiveStatus(document.status) && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {document.errorMessage ? (
            <p className="mt-2 line-clamp-2 text-xs text-red-600 dark:text-red-300" title={document.errorMessage}>
              {document.errorMessage}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
          onClick={canCancel ? onCancel : onRemove}
          title={canCancel ? '取消处理' : '移除'}
        >
          {canCancel ? <Ban className="h-4 w-4" /> : <X className="h-4 w-4" />}
        </Button>
      </div>
    </article>
  )
}

type AttachmentFilter = 'all' | 'active' | 'ready' | 'error'

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
  const [isDesktop, setIsDesktop] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeFilter, setActiveFilter] = useState<AttachmentFilter>('all')
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(mediaQuery.matches)
    update()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update)
      return () => mediaQuery.removeEventListener('change', update)
    }

    mediaQuery.addListener(update)
    return () => mediaQuery.removeListener(update)
  }, [])

  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(documents.map((doc) => doc.id))
      const next = new Set<number>()
      prev.forEach((id) => {
        if (validIds.has(id)) next.add(id)
      })
      return next
    })
  }, [documents])

  const stats = useMemo(() => {
    const processing = documents.filter((doc) => isActiveStatus(doc.status)).length
    const ready = documents.filter((doc) => doc.status === 'ready').length
    const error = documents.filter((doc) => doc.status === 'error').length
    return {
      total: documents.length,
      processing,
      ready,
      error,
    }
  }, [documents])

  const filteredDocuments = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    return documents.filter((doc) => {
      if (activeFilter === 'active' && !isActiveStatus(doc.status)) return false
      if (activeFilter === 'ready' && doc.status !== 'ready') return false
      if (activeFilter === 'error' && doc.status !== 'error') return false
      if (!keyword) return true
      return (
        doc.originalName.toLowerCase().includes(keyword) ||
        doc.filename.toLowerCase().includes(keyword)
      )
    })
  }, [activeFilter, documents, searchKeyword])

  const visibleIds = useMemo(() => filteredDocuments.map((doc) => doc.id), [filteredDocuments])

  const selectedCount = selectedIds.size
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))

  const toggleSelect = useCallback((id: number, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }, [allVisibleSelected, visibleIds])

  const handleBatchRemove = useCallback(() => {
    if (selectedCount === 0) return
    if (!confirm(`确定要删除选中的 ${selectedCount} 个文档吗？删除后无法恢复。`)) return

    if (onBatchRemove) {
      onBatchRemove(Array.from(selectedIds))
    } else {
      // 如果没有批量删除回调，逐个删除
      selectedIds.forEach(id => onRemove(id))
    }
    setSelectedIds(new Set())
    setBatchMode(false)
  }, [selectedCount, onBatchRemove, onRemove, selectedIds])

  const exitBatchMode = useCallback(() => {
    setBatchMode(false)
    setSelectedIds(new Set())
  }, [])

  if (documents.length === 0) return null

  const filterOptions: Array<{ key: AttachmentFilter; label: string; count: number }> = [
    { key: 'all', label: '全部', count: stats.total },
    { key: 'active', label: '处理中', count: stats.processing },
    { key: 'ready', label: '就绪', count: stats.ready },
    { key: 'error', label: '失败', count: stats.error },
  ]

  const hasFilter = activeFilter !== 'all' || searchKeyword.trim().length > 0

  return (
    <Sheet
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          exitBatchMode()
        }
        onOpenChange(isOpen)
      }}
    >
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        showCloseButton
        dialogTitle={title}
        className={cn(
          'flex min-h-0 flex-col border-border/80 bg-card/95',
          isDesktop
            ? 'inset-y-3 right-3 h-[calc(100vh-1.5rem)] w-[min(560px,calc(100vw-1.5rem))] rounded-3xl border'
            : 'max-h-[86vh] rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+8px)]',
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border/70 px-4 pb-4 pt-5 md:px-5 md:pb-5 md:pt-6">
            <div className="rounded-2xl border border-border/70 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground md:text-base">{title}</p>
                  <p className="mt-1 text-xs text-muted-foreground md:text-sm">查看文档状态并执行删除或批量管理。</p>
                </div>
                <Button
                  variant={batchMode ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={batchMode ? exitBatchMode : () => setBatchMode(true)}
                >
                  {batchMode ? '退出批量' : '批量管理'}
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <div className="rounded-xl border border-border/60 bg-background/55 px-3 py-2">
                  <p className="text-[11px] text-muted-foreground">总文件</p>
                  <p className="mt-1 text-base font-semibold text-foreground">{stats.total}</p>
                </div>
                <div className="rounded-xl border border-blue-200/70 bg-blue-50/70 px-3 py-2 dark:border-blue-800/50 dark:bg-blue-950/20">
                  <p className="text-[11px] text-blue-700 dark:text-blue-300">处理中</p>
                  <p className="mt-1 text-base font-semibold text-blue-700 dark:text-blue-200">{stats.processing}</p>
                </div>
                <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 dark:border-emerald-800/50 dark:bg-emerald-950/20">
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">就绪</p>
                  <p className="mt-1 text-base font-semibold text-emerald-700 dark:text-emerald-200">{stats.ready}</p>
                </div>
                <div className="rounded-xl border border-red-200/70 bg-red-50/70 px-3 py-2 dark:border-red-800/50 dark:bg-red-950/20">
                  <p className="text-[11px] text-red-700 dark:text-red-300">失败</p>
                  <p className="mt-1 text-base font-semibold text-red-700 dark:text-red-200">{stats.error}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-3 border-b border-border/70 px-4 py-3 md:px-5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
                placeholder="搜索文件名"
                className="pl-9"
                aria-label="搜索附件文件名"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {filterOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveFilter(option.key)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    activeFilter === option.key
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-[hsl(var(--surface-hover))]',
                  )}
                >
                  <span>{option.label}</span>
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] leading-none">
                    {option.count}
                  </span>
                </button>
              ))}
            </div>
            {batchMode ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-muted/30 px-3 py-2">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleSelectAllVisible} />
                <span className="text-xs text-muted-foreground md:text-sm">
                  {selectedCount > 0 ? `已选择 ${selectedCount} 个` : `全选当前结果（${filteredDocuments.length}）`}
                </span>
                {selectedCount > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                    清空选择
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-5">
            {filteredDocuments.length === 0 ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 text-center">
                <p className="text-sm font-medium text-foreground">
                  {hasFilter ? '没有匹配的附件' : '暂无附件'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {hasFilter ? '试试调整筛选条件或搜索关键词。' : '上传文档后可在这里查看处理状态。'}
                </p>
                {hasFilter ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      setSearchKeyword('')
                      setActiveFilter('all')
                    }}
                  >
                    清除筛选
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredDocuments.map((doc) => (
                  <DocumentPreviewItem
                    key={doc.id}
                    document={doc}
                    onRemove={() => onRemove(doc.id)}
                    onCancel={onCancel ? () => onCancel(doc.id) : undefined}
                    selectable={batchMode}
                    selected={selectedIds.has(doc.id)}
                    onSelectChange={(selected) => toggleSelect(doc.id, selected)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border/70 px-4 py-3 md:px-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground md:text-sm">
                {batchMode ? `批量模式 · 已选择 ${selectedCount} 个文件` : `共 ${stats.total} 个文件`}
              </p>
              <div className="flex items-center gap-2">
                {batchMode ? (
                  <Button variant="destructive" size="sm" onClick={handleBatchRemove} disabled={selectedCount === 0}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    删除所选
                  </Button>
                ) : null}
                <SheetClose asChild>
                  <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    关闭
                  </Button>
                </SheetClose>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
