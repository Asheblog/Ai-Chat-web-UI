/**
 * 工作区文件托盘组件
 * 展示已上传/上传中/失败的文件列表，支持重试和移除
 */

import React, { useMemo, useState } from 'react'
import { AlertCircle, File, FileText, Loader2, RefreshCw, Search, Table, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetClose, SheetContent } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { WorkspaceFile } from './use-workspace-files'

function getFileIcon(mimeType: string) {
  if (mimeType.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />
  if (mimeType.includes('word') || mimeType.includes('document')) return <FileText className="h-4 w-4 text-blue-500" />
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType.includes('csv'))
    return <Table className="h-4 w-4 text-green-500" />
  return <File className="h-4 w-4 text-muted-foreground" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function getStatusLabel(status: WorkspaceFile['status']): string {
  switch (status) {
    case 'uploading':
      return '上传中'
    case 'ready':
      return '就绪'
    case 'error':
      return '上传失败'
  }
}

interface WorkspaceFileTrayProps {
  files: WorkspaceFile[]
  onRemove: (localId: string) => void
  onRetry?: (localId: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

export const WorkspaceFileTray: React.FC<WorkspaceFileTrayProps> = ({
  files,
  onRemove,
  onRetry,
  open,
  onOpenChange,
  title = '文件管理',
}) => {
  const [isDesktop, setIsDesktop] = useState(false)
  const [searchKeyword, setSearchKeyword] = useState('')

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 768px)')
    const update = () => setIsDesktop(mq.matches)
    update()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update)
      return () => mq.removeEventListener('change', update)
    }
    mq.addListener(update)
    return () => mq.removeListener(update)
  }, [])

  const filteredFiles = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase()
    if (!keyword) return files
    return files.filter((f) => f.originalName.toLowerCase().includes(keyword))
  }, [files, searchKeyword])

  if (files.length === 0) return null

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
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
              <p className="text-sm font-semibold text-foreground md:text-base">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground md:text-sm">
                文件会作为当前会话工作材料供 AI 读取；上传失败的文件不会随消息发送。
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70 md:text-xs">
                支持 PDF / Word / Excel / CSV / 纯文本 / Markdown / JSON / 代码文件 · 单文件最大 100MB
              </p>
              <div className="mt-3 rounded-xl border border-border/60 bg-background/55 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">总文件</p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  {files.length}
                  {files.some((f) => f.status === 'uploading')
                    ? `（${files.filter((f) => f.status === 'uploading').length} 上传中）`
                    : ''}
                </p>
              </div>
            </div>
          </div>

          <div className="shrink-0 px-4 py-3 md:px-5">
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
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-5">
            {filteredFiles.length === 0 ? (
              <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 text-center">
                <p className="text-sm font-medium text-foreground">没有匹配的文件</p>
                <p className="mt-1 text-xs text-muted-foreground">试试调整搜索关键词。</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredFiles.map((file) => (
                  <article
                    key={file.localId}
                    className={cn(
                      'rounded-2xl border px-3 py-3 md:px-4',
                      'bg-[hsl(var(--surface))/0.72] transition-colors hover:bg-[hsl(var(--surface-hover))]',
                      file.status === 'error' && 'border-destructive/40 bg-destructive/5',
                      file.status === 'uploading' && 'border-primary/30 bg-primary/[0.03]',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                          file.status === 'error'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-primary/10 text-primary',
                        )}
                      >
                        {file.status === 'uploading' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : file.status === 'error' ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          getFileIcon(file.mimeType)
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground" title={file.originalName}>
                          {file.originalName}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatFileSize(file.fileSize)}
                          {' · '}
                          <span
                            className={cn(
                              file.status === 'error' && 'text-destructive',
                              file.status === 'uploading' && 'text-primary',
                            )}
                          >
                            {getStatusLabel(file.status)}
                          </span>
                        </p>
                        {file.status === 'error' && file.errorMessage ? (
                          <p className="mt-0.5 text-[11px] text-destructive/80">{file.errorMessage}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {file.status === 'error' && onRetry && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary"
                            onClick={() => onRetry(file.localId)}
                            aria-label="重试上传"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => onRemove(file.localId)}
                          aria-label={`移除 ${file.originalName}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border/70 px-4 py-3 md:px-5">
            <SheetClose asChild>
              <Button variant="outline" size="sm" className="w-full">
                关闭
              </Button>
            </SheetClose>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
