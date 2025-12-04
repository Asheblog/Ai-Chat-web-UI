import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { TaskTraceSummary } from '@/types'
import { Download, Trash2 } from 'lucide-react'
import { statusLabels, formatDateTime, formatDuration } from './TaskTraceConsole.utils'
import type { FC } from 'react'

type TaskTraceTableProps = {
  items: TaskTraceSummary[]
  loading: boolean
  deletingId: number | null
  onOpenDetail: (trace: TaskTraceSummary) => void
  onExport: (id: number) => void
  onDelete: (trace: TaskTraceSummary) => void
}

export const TaskTraceTable: FC<TaskTraceTableProps> = ({
  items,
  loading,
  deletingId,
  onOpenDetail,
  onExport,
  onDelete,
}) => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>ID</TableHead>
        <TableHead>会话</TableHead>
        <TableHead>Actor</TableHead>
        <TableHead>状态</TableHead>
        <TableHead>开始时间</TableHead>
        <TableHead>耗时</TableHead>
        <TableHead>事件数</TableHead>
        <TableHead>LaTeX</TableHead>
        <TableHead className="text-right">操作</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {loading && (
        <TableRow>
          <TableCell colSpan={9}>
            <Skeleton className="h-10 w-full" />
          </TableCell>
        </TableRow>
      )}
      {!loading && items.length === 0 && (
        <TableRow>
          <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
            暂无记录
          </TableCell>
        </TableRow>
      )}
      {items.map((item) => (
        <TableRow
          key={item.id}
          className="cursor-pointer hover:bg-muted/40"
          onClick={() => onOpenDetail(item)}
        >
          <TableCell>{item.id}</TableCell>
          <TableCell>{item.sessionId ?? '-'}</TableCell>
          <TableCell className="max-w-[180px] truncate text-muted-foreground">
            {item.actor}
          </TableCell>
          <TableCell>
            <Badge
              variant={
                item.status === 'completed'
                  ? 'default'
                  : item.status === 'error'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {statusLabels[item.status] ?? item.status}
            </Badge>
          </TableCell>
          <TableCell>{formatDateTime(item.startedAt)}</TableCell>
          <TableCell>{formatDuration(item.durationMs)}</TableCell>
          <TableCell>{item.eventCount}</TableCell>
          <TableCell>
            {item.latexTrace ? (
              <div className="text-xs text-muted-foreground">
                <div>匹配 {item.latexTrace.matchedBlocks}</div>
                <div>遗漏 {item.latexTrace.unmatchedBlocks}</div>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">-</span>
            )}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="text-primary"
                onClick={(e) => {
                  e.stopPropagation()
                  onExport(item.id)
                }}
              >
                <Download className="mr-1 h-4 w-4" />
                导出
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={deletingId === item.id}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(item)
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {deletingId === item.id ? '删除中' : '删除'}
              </Button>
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
)
