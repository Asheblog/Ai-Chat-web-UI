/**
 * 工作区文件托盘组件
 * 展示已上传到 workspace 的文件列表（简化版，无处理状态/轮询）
 */

import React, { useMemo, useState } from 'react'
import { File, FileText, Search, Table, Trash2, X } from 'lucide-react'
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

interface WorkspaceFileTrayProps {
  files: WorkspaceFile[]
  onRemove: (workspacePath: string) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
}

export const WorkspaceFileTray: React.FC<WorkspaceFileTrayProps> = ({
  files,
  onRemove,
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
                文件已上传至工作区，AI 可通过 Python 工具直接读取。
              </p>
              <div className="mt-3 rounded-xl border border-border/60 bg-background/55 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">总文件</p>
                <p className="mt-1 text-base font-semibold text-foreground">{files.length}</p>
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
                    key={file.workspacePath}
                    className={cn(
                      'rounded-2xl border border-border/70 px-3 py-3 md:px-4',
                      'bg-[hsl(var(--surface))/0.72] transition-colors hover:bg-[hsl(var(--surface-hover))]',
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {getFileIcon(file.mimeType)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground" title={file.originalName}>
                          {file.originalName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatFileSize(file.fileSize)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 rounded-full hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemove(file.workspacePath)}
                        title="移除"
                      >
                        <X className="h-4 w-4" />
                      </Button>
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
