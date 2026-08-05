"use client"

import { FileText, Filter, Loader2, RefreshCw, Search, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime, formatFileSize } from "@/features/settings/shared"
import { cn } from "@/lib/utils"

export interface DocumentItem {
  id: number
  originalName: string
  mimeType: string
  fileSize: number
  status: string
  chunkCount: number | null
  createdAt: string
  userId: number | null
}

// 状态徽章
const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    ready: 'border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]',
    processing: 'border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]',
    error: 'border border-destructive/30 bg-destructive/10 text-destructive',
    pending: 'border border-border/70 bg-[hsl(var(--surface-hover))] text-muted-foreground',
  }
  const labels: Record<string, string> = {
    ready: '就绪',
    processing: '处理中',
    error: '错误',
    pending: '等待中',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  )
}

export interface DocManageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  documents: DocumentItem[]
  loading: boolean
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
  selectedDocIds: Set<number>
  batchDeleting: boolean
  onToggleSelectAll: () => void
  onToggleSelect: (id: number) => void
  onBatchDelete: () => void
  onDeleteSingle: (id: number) => void
  onClearSelection: () => void
  onRefresh: () => void
}

/** 文档管理弹框：搜索/状态筛选/批量删除（包含向量数据清理和空间回收） */
export function DocManageDialog({
  open,
  onOpenChange,
  documents,
  loading,
  searchQuery,
  onSearchQueryChange,
  statusFilter,
  onStatusFilterChange,
  selectedDocIds,
  batchDeleting,
  onToggleSelectAll,
  onToggleSelect,
  onBatchDelete,
  onDeleteSingle,
  onClearSelection,
  onRefresh,
}: DocManageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>文档管理</DialogTitle>
              <DialogDescription>
                管理所有用户上传的文档，支持批量删除（包含向量数据清理和空间回收）
              </DialogDescription>
            </div>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        </DialogHeader>

        <div className="flex items-center gap-3 py-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索文档名..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={onStatusFilterChange}>
            <SelectTrigger className="w-[140px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="ready">就绪</SelectItem>
              <SelectItem value="processing">处理中</SelectItem>
              <SelectItem value="error">错误</SelectItem>
              <SelectItem value="pending">等待中</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            共 {documents.length} 个文档
          </span>
        </div>

        {selectedDocIds.size > 0 && (
          <div className="flex items-center gap-3 py-2 px-3 bg-muted rounded-lg">
            <span className="text-sm">已选择 {selectedDocIds.size} 个文档</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={onBatchDelete}
              disabled={batchDeleting}
            >
              {batchDeleting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              批量删除
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearSelection}
            >
              取消选择
            </Button>
          </div>
        )}

        <div className="border rounded-lg overflow-auto max-h-[400px]">
          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">加载中...</p>
            </div>
          ) : documents.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>暂无文档</p>
              <p className="text-sm">用户上传的文档将显示在这里</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={selectedDocIds.size === documents.length && documents.length > 0}
                      onCheckedChange={onToggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-[80px]">大小</TableHead>
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead className="w-[80px]">分块数</TableHead>
                  <TableHead className="w-[140px]">上传时间</TableHead>
                  <TableHead className="w-[60px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map(doc => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedDocIds.has(doc.id)}
                        onCheckedChange={() => onToggleSelect(doc.id)}
                      />
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <span className="truncate block" title={doc.originalName}>
                        {doc.originalName}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatFileSize(doc.fileSize)}
                    </TableCell>
                    <TableCell>{getStatusBadge(doc.status)}</TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {doc.chunkCount ?? '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateTime(doc.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-destructive hover:text-destructive"
                        onClick={() => onDeleteSingle(doc.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
