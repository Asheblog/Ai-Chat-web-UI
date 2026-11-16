"use client"

import { BookOpen, FileText, MoreHorizontal, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDateTime } from "@/features/settings/shared"
import type { KnowledgeBaseRow } from "./use-knowledge-base-admin"

export interface KnowledgeBaseListProps {
  knowledgeBases: KnowledgeBaseRow[]
  loading: boolean
  maxFileSizeMb: number
  onRefresh: () => void
  onRequestCreate: () => void
  onOpenDetail: (kb: KnowledgeBaseRow) => void
  onRefreshStats: (kb: KnowledgeBaseRow) => void
  onDelete: (kb: KnowledgeBaseRow) => void
}

/** 知识库列表：管理面入口，与用户可见性策略无关。 */
export function KnowledgeBaseList({
  knowledgeBases,
  loading,
  maxFileSizeMb,
  onRefresh,
  onRequestCreate,
  onOpenDetail,
  onRefreshStats,
  onDelete,
}: KnowledgeBaseListProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-6 text-foreground">知识库</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
            单文件上限 {maxFileSizeMb}MB，与「更多参数」里的文档大小限制是同一个值。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </Button>
          <Button size="sm" onClick={onRequestCreate}>
            <Plus className="mr-1 h-4 w-4" />
            新建知识库
          </Button>
        </div>
      </div>

      {loading && knowledgeBases.length === 0 ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : knowledgeBases.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-8 text-center text-muted-foreground">
          <BookOpen className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>暂无知识库</p>
          <p className="text-sm">创建后即可上传文档并在聊天中选择</p>
        </div>
      ) : (
        <div className="v2-table-wrap">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>文档数</TableHead>
                <TableHead>分块数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {knowledgeBases.map((kb) => (
                <TableRow key={kb.id}>
                  <TableCell>
                    <button
                      className="text-left font-medium hover:underline"
                      onClick={() => onOpenDetail(kb)}
                    >
                      {kb.name}
                    </button>
                    {kb.description ? (
                      <p className="max-w-[200px] truncate text-xs text-ink-tertiary">
                        {kb.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>{kb.documentCount}</TableCell>
                  <TableCell>{kb.totalChunks}</TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        kb.status === "active"
                          ? "border border-[hsl(var(--success)/0.35)] bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
                          : "border border-border bg-[hsl(var(--surface-hover))] text-muted-foreground"
                      }`}
                    >
                      {kb.status === "active" ? "启用" : "禁用"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-ink-tertiary">
                    {formatDateTime(kb.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={`${kb.name} 操作`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onOpenDetail(kb)}>
                          <FileText className="mr-2 h-4 w-4" />
                          查看文档
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onRefreshStats(kb)}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          刷新统计
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => onDelete(kb)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
