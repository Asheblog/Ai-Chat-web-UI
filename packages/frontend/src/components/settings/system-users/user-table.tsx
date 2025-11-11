"use client"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Users, MoreVertical, DollarSign, CheckCircle, XCircle, Shield, UserX, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import type { SystemUserRow } from "@/services/system-users"
import { STATUS_META, formatTimestamp, type SortField, type SortOrder } from "./constants"

type UserTableProps = {
  loading: boolean
  rows: SystemUserRow[]
  sortedRows: SystemUserRow[]
  search: string
  selectedIds: Set<number>
  toggleSelectAll: () => void
  toggleSelectRow: (id: number) => void
  quotaSubmitting: boolean
  actionUserId: number | null
  openQuotaDialog: (row: SystemUserRow) => void
  confirmApprove: (row: SystemUserRow) => void
  confirmEnable: (row: SystemUserRow) => void
  confirmChangeRole: (row: SystemUserRow, role: 'ADMIN' | 'USER') => void
  confirmDelete: (row: SystemUserRow) => void
  openDecisionDialog: (mode: 'REJECT' | 'DISABLE', target: SystemUserRow) => void
  pagination: { page: number; limit: number; totalPages: number }
  changePageSize: (limit: number) => void
  goToPage: (page: number) => void
  sortField: SortField
  sortOrder: SortOrder
  toggleSort: (field: SortField) => void
}

export function UserTable({
  loading,
  rows,
  sortedRows,
  search,
  selectedIds,
  toggleSelectAll,
  toggleSelectRow,
  quotaSubmitting,
  actionUserId,
  openQuotaDialog,
  confirmApprove,
  confirmEnable,
  confirmChangeRole,
  confirmDelete,
  openDecisionDialog,
  pagination,
  changePageSize,
  goToPage,
  sortField,
  sortOrder,
  toggleSort,
}: UserTableProps) {
  const { page, limit, totalPages } = pagination

  return (
    <Card className="px-4 py-4 sm:px-5 sm:py-5">
      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="w-8 h-8" />
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="w-24 h-8" />
              <Skeleton className="w-24 h-8" />
              <Skeleton className="w-32 h-8" />
            </div>
          ))}
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-sm text-muted-foreground mb-2">暂无用户数据</p>
          <p className="text-xs text-muted-foreground">
            {search ? '尝试调整搜索条件或筛选器' : '等待用户注册后将在此显示'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-center">
                  <Checkbox
                    checked={selectedIds.size === sortedRows.length && sortedRows.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead
                  className="w-[200px] cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => toggleSort('username')}
                >
                  用户名 {sortField === 'username' && (sortOrder === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="text-center w-[96px]">角色</TableHead>
                <TableHead
                  className="text-center w-[96px] cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => toggleSort('status')}
                >
                  状态 {sortField === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead
                  className="text-center w-[140px] cursor-pointer hover:bg-muted/80 transition-colors"
                  onClick={() => toggleSort('createdAt')}
                >
                  创建时间 {sortField === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="text-center w-[72px]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((r) => {
                const statusTitle = r.status === 'DISABLED'
                  ? (r.rejectionReason ? `禁用原因：${r.rejectionReason}` : '账户已被禁用')
                  : r.status === 'PENDING'
                    ? '等待管理员审批'
                    : '账户已启用'
                const isActionBusy = actionUserId === r.id || loading
                return (
                  <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="text-center">
                      <Checkbox
                        checked={selectedIds.has(r.id)}
                        onCheckedChange={() => toggleSelectRow(r.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium truncate" title={r.username}>
                      <span className="block truncate">{r.username}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {r.role === 'ADMIN' ? (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          <Shield className="w-3 h-3 mr-1" />
                          管理员
                        </Badge>
                      ) : (
                        <Badge variant="outline">用户</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <Badge
                        className={STATUS_META[r.status].className}
                        title={statusTitle}
                      >
                        {STATUS_META[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(r.createdAt)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" disabled={isActionBusy}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => openQuotaDialog(r)} disabled={quotaSubmitting || isActionBusy}>
                            <DollarSign className="w-4 h-4 mr-2" />
                            调整额度
                          </DropdownMenuItem>
                          {r.status === 'PENDING' && (
                            <>
                              <DropdownMenuItem onClick={() => confirmApprove(r)} disabled={isActionBusy}>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                审批通过
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDecisionDialog('REJECT', r)} disabled={isActionBusy} className="text-destructive">
                                <XCircle className="w-4 h-4 mr-2" />
                                拒绝申请
                              </DropdownMenuItem>
                            </>
                          )}
                          {r.status === 'ACTIVE' && (
                            <DropdownMenuItem onClick={() => openDecisionDialog('DISABLE', r)} disabled={isActionBusy} className="text-destructive">
                              <UserX className="w-4 h-4 mr-2" />
                              禁用用户
                            </DropdownMenuItem>
                          )}
                          {r.status === 'DISABLED' && (
                            <DropdownMenuItem onClick={() => confirmEnable(r)} disabled={isActionBusy}>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              重新启用
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => confirmChangeRole(r, r.role === 'ADMIN' ? 'USER' : 'ADMIN')} disabled={isActionBusy}>
                            <Shield className="w-4 h-4 mr-2" />
                            {r.role === 'ADMIN' ? '设为普通用户' : '设为管理员'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => confirmDelete(r)} disabled={isActionBusy} className="text-destructive">
                            <Trash2 className="w-4 h-4 mr-2" />
                            删除用户
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {/* 分页 */}
          {rows.length > 0 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2 pt-4">
              <div className="text-sm text-muted-foreground">
                第 {page} / {totalPages} 页
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <div className="flex items-center gap-2">
                  <Label className="text-sm text-muted-foreground whitespace-nowrap">每页显示</Label>
                  <Select
                    value={String(limit)}
                    onValueChange={(value) => {
                      const parsed = Number.parseInt(value, 10) || 10
                      changePageSize(parsed)
                    }}
                  >
                    <SelectTrigger className="w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50].map((n) => (
                        <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => goToPage(Math.max(1, page - 1))}
                  >
                    <ChevronLeft className="w-4 h-4 mr-1" />
                    上一页
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => goToPage(Math.min(totalPages, page + 1))}
                  >
                    下一页
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
