"use client"

import type { ChangeEvent } from "react"
import { CheckCircle2, FileText, Loader2, Trash2, Upload, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatFileSize } from "@/features/settings/shared"

export interface KnowledgeBaseDocument {
  id: number
  originalName: string
  mimeType: string
  fileSize: number
  status: string
  chunkCount: number
  addedAt: string
  processingStage?: string
  processingProgress?: number
  errorMessage?: string
}

export interface UploadingFile {
  name: string
  progress: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
}

// 获取处理阶段的显示文本
const getStageText = (stage?: string): string => {
  switch (stage) {
    case 'parsing':
      return '解析文档'
    case 'chunking':
      return '分块处理'
    case 'embedding':
      return '生成向量'
    case 'storing':
      return '存储数据'
    case 'done':
      return '完成'
    case 'error':
      return '失败'
    default:
      return ''
  }
}

export interface KnowledgeBaseDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedKb: { id: number; name: string; description: string | null } | null
  kbDocuments: KnowledgeBaseDocument[]
  docsLoading: boolean
  uploading: boolean
  uploadProgress: number
  uploadingFiles: UploadingFile[]
  selectedDocIds: Set<number>
  batchDeleting: boolean
  onToggleSelectAll: () => void
  onToggleSelect: (docId: number) => void
  onBatchRemove: () => void
  onRemoveDocument: (docId: number) => void
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void
}

/** 知识库详情 slide-over：文档上传（进度/结果）/批量移除/处理阶段轮询展示 */
export function KnowledgeBaseDetailDialog({
  open,
  onOpenChange,
  selectedKb,
  kbDocuments,
  docsLoading,
  uploading,
  uploadProgress,
  uploadingFiles,
  selectedDocIds,
  batchDeleting,
  onToggleSelectAll,
  onToggleSelect,
  onBatchRemove,
  onRemoveDocument,
  onUpload,
}: KnowledgeBaseDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="v2-slide-over left-auto right-0 top-0 flex h-[100dvh] max-h-none w-[min(420px,100vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>{selectedKb?.name}</DialogTitle>
          <DialogDescription>
            {selectedKb?.description || "管理知识库中的文档"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                共 {kbDocuments.length} 个文档
              </span>
              <div>
                <input
                  type="file"
                  id="kb-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.xls"
                  onChange={onUpload}
                  disabled={uploading}
                  multiple
                />
                <Button
                  size="sm"
                  onClick={() => document.getElementById('kb-upload')?.click()}
                  disabled={uploading}
                >
                  <Upload className="h-4 w-4 mr-1" />
                  {uploading ? "上传中..." : "上传文档"}
                </Button>
              </div>
            </div>

            {uploading && uploadingFiles.length > 0 && (
              <div className="p-3 border rounded-lg bg-muted/50 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    正在上传 {uploadingFiles.length} 个文件
                  </span>
                  <span className="text-muted-foreground">
                    {uploadProgress < 100 ? `${uploadProgress}%` : '处理中...'}
                  </span>
                </div>
                <div className="h-2 w-full rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="max-h-[150px] overflow-y-auto space-y-1">
                  {uploadingFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between text-xs">
                      <span className="truncate max-w-[200px]">{file.name}</span>
                      <span className={
                        file.status === 'success' ? 'text-[hsl(var(--success))]' :
                        file.status === 'error' ? 'text-destructive' :
                        'text-muted-foreground'
                      }>
                        {file.status === 'pending' && '等待中'}
                        {file.status === 'uploading' && '上传中'}
                        {file.status === 'success' && (
                          <span className="inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            成功
                          </span>
                        )}
                        {file.status === 'error' && (
                          <span className="inline-flex items-center gap-1">
                            <XCircle className="h-3 w-3" />
                            {file.error || '失败'}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {uploadProgress === 100 && uploadingFiles.every(f => f.status === 'uploading') && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    文件已上传，正在等待服务器处理...
                  </p>
                )}
              </div>
            )}
          </div>

          {docsLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : kbDocuments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border rounded-lg">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>暂无文档</p>
              <p className="text-sm">上传文档以构建知识库</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between py-2 border-b">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedDocIds.size === kbDocuments.length && kbDocuments.length > 0}
                    onCheckedChange={onToggleSelectAll}
                  />
                  <span className="text-sm text-muted-foreground">
                    {selectedDocIds.size > 0 ? `已选择 ${selectedDocIds.size} 项` : '全选'}
                  </span>
                </div>
                {selectedDocIds.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onBatchRemove}
                    disabled={batchDeleting}
                  >
                    {batchDeleting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        删除中...
                      </>
                    ) : (
                      <>
                        <Trash2 className="h-4 w-4 mr-1" />
                        批量删除 ({selectedDocIds.size})
                      </>
                    )}
                  </Button>
                )}
              </div>
              <div className="max-h-[400px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>文件名</TableHead>
                      <TableHead>大小</TableHead>
                      <TableHead>分块</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kbDocuments.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedDocIds.has(doc.id)}
                            onCheckedChange={() => onToggleSelect(doc.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate max-w-[200px]">{doc.originalName}</span>
                          </div>
                        </TableCell>
                        <TableCell>{formatFileSize(doc.fileSize)}</TableCell>
                        <TableCell>{doc.chunkCount}</TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded ${doc.status === 'ready'
                                ? 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]'
                                : doc.status === 'processing'
                                  ? 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]'
                                  : doc.status === 'error'
                                    ? 'border border-destructive/30 bg-destructive/10 text-destructive'
                                    : 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground'
                                }`}>
                                {doc.status === 'ready' ? '就绪' :
                                  doc.status === 'processing' ? '处理中' :
                                    doc.status === 'error' ? '错误' :
                                      doc.status === 'pending' ? '等待中' : doc.status}
                              </span>
                              {(doc.status === 'processing' || doc.status === 'pending') && (
                                <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--warning))]" />
                              )}
                            </div>
                            {(doc.status === 'processing' || doc.status === 'pending') && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <span>{getStageText(doc.processingStage) || '准备中'}</span>
                                  {typeof doc.processingProgress === 'number' && (
                                    <span>({doc.processingProgress}%)</span>
                                  )}
                                </div>
                                {typeof doc.processingProgress === 'number' && (
                                  <div className="h-1.5 w-20 rounded bg-muted">
                                    <div
                                      className="h-1.5 rounded bg-[hsl(var(--warning))] transition-all"
                                      style={{ width: `${Math.min(100, doc.processingProgress)}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                            {doc.status === 'error' && doc.errorMessage && (
                              <p className="text-xs text-destructive truncate max-w-[150px]" title={doc.errorMessage}>
                                {doc.errorMessage}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => onRemoveDocument(doc.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
