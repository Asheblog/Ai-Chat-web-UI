"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardTitle, CardDescription } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { apiClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import type { ActorQuota } from "@/types"
import {
  Users,
  RefreshCw,
  Search,
  X,
  MoreVertical,
  DollarSign,
  CheckCircle,
  XCircle,
  Shield,
  UserX,
  Trash2,
  ChevronLeft,
  ChevronRight,
  UserCheck
} from "lucide-react"

type UserRow = {
  id: number
  username: string
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DISABLED'
  createdAt: string
  approvedAt: string | null
  approvedById: number | null
  rejectedAt: string | null
  rejectedById: number | null
  rejectionReason: string | null
  _count?: { chatSessions: number; connections: number }
}
type PageData = { users: UserRow[]; pagination: { page: number; limit: number; total: number; totalPages: number } }

type StatusFilter = 'ALL' | 'PENDING' | 'ACTIVE' | 'DISABLED'
type ConfirmMode = 'APPROVE' | 'ENABLE' | 'CHANGE_ROLE' | 'DELETE'
type SortField = 'username' | 'createdAt' | 'status'
type SortOrder = 'asc' | 'desc'

const STATUS_META: Record<'PENDING' | 'ACTIVE' | 'DISABLED', { label: string; className: string }> = {
  PENDING: { label: '待审批', className: 'bg-blue-100/60 text-blue-700 border-blue-200' },
  ACTIVE: { label: '已启用', className: 'bg-emerald-100/60 text-emerald-700 border-emerald-200' },
  DISABLED: { label: '已禁用', className: 'bg-rose-100/60 text-rose-700 border-rose-200' },
}

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: '全部状态' },
  { value: 'PENDING', label: '待审批' },
  { value: 'ACTIVE', label: '已启用' },
  { value: 'DISABLED', label: '已禁用' },
]

const formatTimestamp = (value?: string | null) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SystemUsersPage(){
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<UserRow[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState("")
  const [searchDraft, setSearchDraft] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [actionUserId, setActionUserId] = useState<number | null>(null)

  // 排序状态
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // 额度对话框状态
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<UserRow | null>(null)
  const [quotaSnapshot, setQuotaSnapshot] = useState<ActorQuota | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [quotaSubmitting, setQuotaSubmitting] = useState(false)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [quotaForm, setQuotaForm] = useState<{ useDefault: boolean; dailyLimit: string; resetUsed: boolean }>({
    useDefault: true,
    dailyLimit: "",
    resetUsed: false,
  })

  // 拒绝/禁用对话框状态
  const [decisionDialog, setDecisionDialog] = useState<{
    open: boolean
    mode: 'REJECT' | 'DISABLE'
    target: UserRow | null
    reason: string
    submitting: boolean
    error: string | null
  }>({
    open: false,
    mode: 'REJECT',
    target: null,
    reason: '',
    submitting: false,
    error: null,
  })

  // 确认对话框状态
  const [confirmState, setConfirmState] = useState<{ open: boolean; mode: ConfirmMode | null; target: UserRow | null; role?: 'ADMIN' | 'USER' }>({
    open: false,
    mode: null,
    target: null,
    role: undefined,
  })
  const [confirmLoading, setConfirmLoading] = useState(false)

  const load = async (opts?: { page?: number; limit?: number; search?: string; status?: StatusFilter }) => {
    setLoading(true); setError(null)
    try {
      const nextStatus = opts?.status ?? statusFilter
      const statusForQuery = nextStatus === 'ALL' ? undefined : nextStatus
      const res = await apiClient.getUsers({
        page: opts?.page ?? page,
        limit: opts?.limit ?? limit,
        search: typeof opts?.search === 'string' ? opts?.search : search,
        status: statusForQuery,
      })
      const data = res?.data as PageData | undefined
      setRows(data?.users || [])
      if (data?.pagination) {
        setPage(data.pagination.page)
        setLimit(data.pagination.limit)
        setTotalPages(data.pagination.totalPages)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '加载失败')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() // 初次加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resetQuotaDialog = () => {
    setQuotaTarget(null)
    setQuotaSnapshot(null)
    setQuotaForm({ useDefault: true, dailyLimit: "", resetUsed: false })
    setQuotaError(null)
    setQuotaLoading(false)
    setQuotaSubmitting(false)
  }

  const handleQuotaDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetQuotaDialog()
    }
    setQuotaDialogOpen(nextOpen)
  }

  const openQuotaDialog = async (row: UserRow) => {
    setQuotaTarget(row)
    setQuotaDialogOpen(true)
    setQuotaLoading(true)
    setQuotaError(null)
    setQuotaSnapshot(null)
    setQuotaForm({ useDefault: true, dailyLimit: "", resetUsed: false })
    try {
      const response = await apiClient.getUserQuota(row.id)
      if (!response?.success) {
        throw new Error(response?.error || '获取用户额度失败')
      }
      const quota = response.data?.quota ?? null
      setQuotaSnapshot(quota)
      if (quota) {
        setQuotaForm({
          useDefault: quota.usingDefaultLimit,
          dailyLimit: quota.customDailyLimit != null ? String(quota.customDailyLimit) : "",
          resetUsed: false,
        })
      } else {
        setQuotaForm({ useDefault: true, dailyLimit: "", resetUsed: false })
      }
    } catch (e: any) {
      setQuotaError(e?.message || '获取用户额度失败')
    } finally {
      setQuotaLoading(false)
    }
  }

  const handleQuotaSave = async () => {
    if (!quotaTarget) return
    setQuotaError(null)
    let resolvedDailyLimit: number | null = null
    if (!quotaForm.useDefault) {
      const trimmed = quotaForm.dailyLimit.trim()
      if (!trimmed) {
        setQuotaError('请输入自定义额度')
        return
      }
      const parsed = Number.parseInt(trimmed, 10)
      if (Number.isNaN(parsed) || parsed < 0) {
        setQuotaError('额度必须为不小于 0 的整数')
        return
      }
      resolvedDailyLimit = parsed
    }
    setQuotaSubmitting(true)
    try {
      const response = await apiClient.updateUserQuota(quotaTarget.id, {
        dailyLimit: resolvedDailyLimit,
        resetUsed: quotaForm.resetUsed || undefined,
      })
      if (!response?.success) {
        throw new Error(response?.error || '更新用户额度失败')
      }
      toast({
        title: '额度已更新',
        description: quotaForm.useDefault ? '已恢复跟随全局默认额度' : `已设置每日额度为 ${resolvedDailyLimit}`,
      })
      handleQuotaDialogOpenChange(false)
      await load()
    } catch (e: any) {
      setQuotaError(e?.message || '更新用户额度失败')
    } finally {
      setQuotaSubmitting(false)
    }
  }

  const onSearch = () => {
    const keyword = searchDraft.trim()
    setPage(1)
    setSearch(keyword)
    load({ page: 1, search: keyword, status: statusFilter })
  }
  const onClearSearch = () => {
    setSearchDraft("")
    setSearch("")
    setPage(1)
    load({ page: 1, search: '', status: statusFilter })
  }

  const handleStatusFilterChange = (value: StatusFilter) => {
    setStatusFilter(value)
    setPage(1)
    load({ page: 1, search, status: value })
  }

  const openDecisionDialog = (mode: 'REJECT' | 'DISABLE', target: UserRow) => {
    setDecisionDialog({
      open: true,
      mode,
      target,
      reason: target.rejectionReason ?? '',
      submitting: false,
      error: null,
    })
  }

  const closeDecisionDialog = () => {
    setDecisionDialog({
      open: false,
      mode: 'REJECT',
      target: null,
      reason: '',
      submitting: false,
      error: null,
    })
  }

  const submitDecisionDialog = async () => {
    if (!decisionDialog.target) return
    setDecisionDialog((prev) => ({ ...prev, submitting: true, error: null }))
    try {
      if (decisionDialog.mode === 'REJECT') {
        await apiClient.rejectUser(decisionDialog.target.id, decisionDialog.reason)
        toast({ title: '已拒绝注册', description: `用户 ${decisionDialog.target.username} 已标记为禁用` })
      } else {
        await apiClient.updateUserStatus(decisionDialog.target.id, 'DISABLED', decisionDialog.reason)
        toast({ title: '已禁用用户', description: `用户 ${decisionDialog.target.username} 已被禁用` })
      }
      closeDecisionDialog()
      await load()
    } catch (e: any) {
      setDecisionDialog((prev) => ({
        ...prev,
        error: e?.response?.data?.error || e?.message || '操作失败',
        submitting: false,
      }))
    }
  }

  const openConfirm = (mode: ConfirmMode, target: UserRow, extras?: { role?: 'ADMIN' | 'USER' }) => {
    setConfirmState({ open: true, mode, target, role: extras?.role })
  }

  const closeConfirm = () => {
    if (confirmLoading) return
    setConfirmState({ open: false, mode: null, target: null, role: undefined })
  }

  const confirmApprove = (row: UserRow) => openConfirm('APPROVE', row)
  const confirmEnable = (row: UserRow) => openConfirm('ENABLE', row)
  const confirmChangeRole = (row: UserRow, role: 'ADMIN' | 'USER') => openConfirm('CHANGE_ROLE', row, { role })
  const confirmDelete = (row: UserRow) => openConfirm('DELETE', row)

  const runConfirmAction = async () => {
    if (!confirmState.mode || !confirmState.target) return
    setConfirmLoading(true)
    setActionUserId(confirmState.target.id)
    const username = confirmState.target.username
    try {
      switch (confirmState.mode) {
        case 'APPROVE':
          await apiClient.approveUser(confirmState.target.id)
          toast({ title: '审批通过', description: `用户 ${username} 已可登录` })
          break
        case 'ENABLE':
          await apiClient.updateUserStatus(confirmState.target.id, 'ACTIVE')
          toast({ title: '已启用用户', description: `用户 ${username} 可以重新登录` })
          break
        case 'CHANGE_ROLE': {
          const role = confirmState.role
          if (!role) throw new Error('缺少角色参数')
          await apiClient.updateUserRole(confirmState.target.id, role)
          toast({ title: '已更新用户角色', description: role === 'ADMIN' ? '已设为管理员' : '已设为普通用户' })
          break
        }
        case 'DELETE':
          await apiClient.deleteUser(confirmState.target.id)
          toast({ title: '已删除用户' })
          break
      }
      await load()
    } catch (e: any) {
      const message = e?.response?.data?.error || e?.message || '操作失败'
      const failTitle = (() => {
        switch (confirmState.mode) {
          case 'APPROVE': return '审批失败'
          case 'ENABLE': return '启用失败'
          case 'CHANGE_ROLE': return '更新失败'
          case 'DELETE': return '删除失败'
          default: return '操作失败'
        }
      })()
      toast({ title: failTitle, description: message, variant: 'destructive' })
    } finally {
      setConfirmLoading(false)
      setActionUserId(null)
      setConfirmState({ open: false, mode: null, target: null, role: undefined })
    }
  }

  const confirmMeta = useMemo(() => {
    if (!confirmState.mode || !confirmState.target) return null
    const username = confirmState.target.username
    switch (confirmState.mode) {
      case 'APPROVE':
        return {
          title: '审批通过确认',
          description: `确认审批通过 "${username}"？审批通过后,用户可立即登录系统。`,
          action: '确认通过',
        }
      case 'ENABLE':
        return {
          title: '启用用户',
          description: `确认启用 "${username}"？启用后用户可以重新登录并使用系统。`,
          action: '确认启用',
        }
      case 'CHANGE_ROLE': {
        const role = confirmState.role
        const roleLabel = role === 'ADMIN' ? '管理员' : '普通用户'
        return {
          title: '变更用户角色',
          description: `确认将 "${username}" 角色调整为 ${roleLabel}？该操作会立即生效。`,
          action: '确认变更',
        }
      }
      case 'DELETE':
        return {
          title: '删除用户',
          description: `确认删除 "${username}"？该操作不可恢复,将级联删除该用户的会话与消息。`,
          action: '确认删除',
        }
      default:
        return null
    }
  }, [confirmState])

  // 排序逻辑
  const sortedRows = useMemo(() => {
    const sorted = [...rows]
    sorted.sort((a, b) => {
      let comparison = 0
      if (sortField === 'username') {
        comparison = a.username.localeCompare(b.username)
      } else if (sortField === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      } else if (sortField === 'status') {
        comparison = a.status.localeCompare(b.status)
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })
    return sorted
  }, [rows, sortField, sortOrder])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // 批量选择逻辑
  const toggleSelectAll = () => {
    if (selectedIds.size === sortedRows.length && sortedRows.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedRows.map(r => r.id)))
    }
  }

  const toggleSelectRow = (id: number) => {
    const newSet = new Set(selectedIds)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedIds(newSet)
  }

  // 批量操作
  const handleBatchEnable = async () => {
    const ids = Array.from(selectedIds)
    setLoading(true)
    try {
      await Promise.all(ids.map(id => apiClient.updateUserStatus(id, 'ACTIVE')))
      toast({ title: '批量启用成功', description: `已启用 ${ids.length} 个用户` })
      setSelectedIds(new Set())
      await load()
    } catch (e: any) {
      toast({ title: '批量启用失败', description: e?.message || '操作失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleBatchDisable = async () => {
    const ids = Array.from(selectedIds)
    setLoading(true)
    try {
      await Promise.all(ids.map(id => apiClient.updateUserStatus(id, 'DISABLED')))
      toast({ title: '批量禁用成功', description: `已禁用 ${ids.length} 个用户` })
      setSelectedIds(new Set())
      await load()
    } catch (e: any) {
      toast({ title: '批量禁用失败', description: e?.message || '操作失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleBatchDelete = async () => {
    const ids = Array.from(selectedIds)
    setLoading(true)
    try {
      await Promise.all(ids.map(id => apiClient.deleteUser(id)))
      toast({ title: '批量删除成功', description: `已删除 ${ids.length} 个用户` })
      setSelectedIds(new Set())
      await load()
    } catch (e: any) {
      toast({ title: '批量删除失败', description: e?.message || '操作失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const pagination = useMemo(() => ({ page, limit, totalPages }), [page, limit, totalPages])

  return (
    <div className="space-y-6">

      {/* 搜索筛选区块 */}
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b">
          <Users className="w-5 h-5 text-primary" />
          <div>
            <CardTitle className="text-lg">用户管理</CardTitle>
            <CardDescription>管理系统用户、审批注册、调整权限和额度</CardDescription>
          </div>
        </div>

        <Card className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2 flex-1">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="搜索用户名..."
                  value={searchDraft}
                  onChange={(e)=>setSearchDraft(e.target.value)}
                  className="pl-9"
                  onKeyDown={(e)=>{ if(e.key==='Enter') onSearch() }}
                />
              </div>
              <Button variant="default" onClick={onSearch} disabled={loading} className="w-full sm:w-auto">
                搜索
              </Button>
              {search && (
                <Button variant="ghost" onClick={onClearSearch} disabled={loading} className="w-full sm:w-auto">
                  <X className="w-4 h-4 mr-1" />
                  清空
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <Select value={statusFilter} onValueChange={(value) => handleStatusFilterChange(value as StatusFilter)}>
                <SelectTrigger className="w-full sm:w-[140px]">
                  <SelectValue placeholder="状态筛选" />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={()=>load()} disabled={loading} className="w-full sm:w-auto">
                <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {error && (
        <div className="text-sm text-destructive px-4 py-3 bg-destructive/10 rounded border border-destructive/20">
          {error}
        </div>
      )}

      {/* 批量操作栏 */}
      {selectedIds.size > 0 && (
        <Card className="px-4 py-3 sm:px-5 sm:py-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium">
              已选择 {selectedIds.size} 个用户
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
              <Button size="sm" variant="outline" onClick={handleBatchEnable} disabled={loading}>
                <UserCheck className="w-4 h-4 mr-1" />
                批量启用
              </Button>
              <Button size="sm" variant="outline" onClick={handleBatchDisable} disabled={loading}>
                <UserX className="w-4 h-4 mr-1" />
                批量禁用
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBatchDelete} disabled={loading}>
                <Trash2 className="w-4 h-4 mr-1" />
                批量删除
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                取消选择
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* 用户列表区块 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">用户列表</CardTitle>
        </div>

        <Card className="px-4 py-4 sm:px-5 sm:py-5">
          {loading && rows.length === 0 ? (
            // 骨架屏加载
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
            // 空状态
            <div className="text-center py-12">
              <Users className="w-16 h-16 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-sm text-muted-foreground mb-2">暂无用户数据</p>
              <p className="text-xs text-muted-foreground">
                {search ? '尝试调整搜索条件或筛选器' : '等待用户注册后将在此显示'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full table-fixed">
                <TableHeader className="sticky top-0 z-30 bg-muted/50">
                  <TableRow>
                    <TableHead className="w-12 text-center">
                      <Checkbox
                        checked={selectedIds.size === sortedRows.length && sortedRows.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead
                      className="w-[160px] cursor-pointer hover:bg-muted/80 transition-colors"
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
                            onChange={() => toggleSelectRow(r.id)}
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
                              <DropdownMenuItem onClick={()=>openQuotaDialog(r)} disabled={quotaSubmitting || isActionBusy}>
                                <DollarSign className="w-4 h-4 mr-2" />
                                调整额度
                              </DropdownMenuItem>
                              {r.status === 'PENDING' && (
                                <>
                                  <DropdownMenuItem onClick={()=>confirmApprove(r)} disabled={isActionBusy}>
                                    <CheckCircle className="w-4 h-4 mr-2" />
                                    审批通过
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={()=>openDecisionDialog('REJECT', r)} disabled={isActionBusy} className="text-destructive">
                                    <XCircle className="w-4 h-4 mr-2" />
                                    拒绝申请
                                  </DropdownMenuItem>
                                </>
                              )}
                              {r.status === 'ACTIVE' && (
                                <DropdownMenuItem onClick={()=>openDecisionDialog('DISABLE', r)} disabled={isActionBusy} className="text-destructive">
                                  <UserX className="w-4 h-4 mr-2" />
                                  禁用用户
                                </DropdownMenuItem>
                              )}
                              {r.status === 'DISABLED' && (
                                <DropdownMenuItem onClick={()=>confirmEnable(r)} disabled={isActionBusy}>
                                  <UserCheck className="w-4 h-4 mr-2" />
                                  启用用户
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              {r.role !== 'ADMIN' && (
                                <DropdownMenuItem onClick={()=>confirmChangeRole(r, 'ADMIN')} disabled={isActionBusy}>
                                  <Shield className="w-4 h-4 mr-2" />
                                  设为管理员
                                </DropdownMenuItem>
                              )}
                              {r.role !== 'USER' && (
                                <DropdownMenuItem onClick={()=>confirmChangeRole(r, 'USER')} disabled={isActionBusy}>
                                  设为普通用户
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={()=>confirmDelete(r)} disabled={isActionBusy} className="text-destructive">
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
            </div>
          )}
        </Card>
      </div>

      {/* 分页控制 */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-2">
          <div className="text-sm text-muted-foreground">
            第 {pagination.page} / {pagination.totalPages} 页
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">每页显示</Label>
              <Select
                value={String(limit)}
                onValueChange={(value)=>{
                  const l = parseInt(value)||10;
                  setLimit(l);
                  setPage(1);
                  load({ page:1, limit:l, status: statusFilter })
                }}
              >
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10,20,50].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page<=1 || loading}
                onClick={()=>{
                  const p=Math.max(1,page-1);
                  setPage(p);
                  load({ page: p, status: statusFilter })
                }}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                上一页
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page>=totalPages || loading}
                onClick={()=>{
                  const p=Math.min(totalPages,page+1);
                  setPage(p);
                  load({ page: p, status: statusFilter })
                }}
              >
                下一页
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 确认对话框 */}
      {confirmMeta && (
        <AlertDialog open={confirmState.open} onOpenChange={(open)=>{ if (!open) closeConfirm(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmMeta.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmMeta.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={confirmLoading}>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={runConfirmAction}
                disabled={confirmLoading}
                className={confirmState.mode === 'DELETE' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              >
                {confirmLoading ? '执行中…' : confirmMeta.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* 额度调整对话框 */}
      <Dialog open={quotaDialogOpen} onOpenChange={handleQuotaDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>调整每日额度</DialogTitle>
            <DialogDescription>
              {quotaTarget ? `用户：${quotaTarget.username}` : '选择要调整额度的用户'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {quotaError && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
                {quotaError}
              </div>
            )}
            <div className="space-y-1 text-sm">
              <div>当前每日额度</div>
              <div className="text-lg font-semibold">
                {quotaLoading
                  ? '加载中...'
                  : quotaSnapshot
                    ? (quotaSnapshot.unlimited ? '无限' : quotaSnapshot.dailyLimit)
                    : '-'}
              </div>
              {quotaSnapshot && (
                <div className="text-xs text-muted-foreground">
                  已使用 {quotaSnapshot.usedCount}
                  {quotaSnapshot.unlimited ? '' : ` / ${quotaSnapshot.dailyLimit}`}
                  ，上次重置 {new Date(quotaSnapshot.lastResetAt).toLocaleString()}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="useDefaultQuota" className="text-sm">跟随全局默认额度</Label>
                <Switch
                  id="useDefaultQuota"
                  checked={quotaForm.useDefault}
                  disabled={quotaLoading || quotaSubmitting}
                  onCheckedChange={(checked) => setQuotaForm((prev) => ({
                    ...prev,
                    useDefault: checked,
                    dailyLimit: checked ? "" : prev.dailyLimit,
                  }))}
                />
              </div>
              {!quotaForm.useDefault && (
                <div className="space-y-2">
                  <Label htmlFor="customDailyLimit" className="text-sm">自定义每日额度</Label>
                  <Input
                    id="customDailyLimit"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={quotaForm.dailyLimit}
                    onChange={(e) => setQuotaForm((prev) => ({ ...prev, dailyLimit: e.target.value }))}
                    disabled={quotaLoading || quotaSubmitting}
                    placeholder="例如：5000"
                  />
                  <p className="text-xs text-muted-foreground">设置为 0 表示禁止发送消息，留空将无法保存。</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="resetUsed"
                  checked={quotaForm.resetUsed}
                  disabled={quotaLoading || quotaSubmitting}
                  onChange={(e) => setQuotaForm((prev) => ({ ...prev, resetUsed: e.target.checked }))}
                />
                <Label htmlFor="resetUsed" className="text-sm">保存时同时清零已用额度</Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleQuotaDialogOpenChange(false)} disabled={quotaSubmitting}>
              取消
            </Button>
            <Button
              type="button"
              onClick={handleQuotaSave}
              disabled={
                quotaSubmitting
                || quotaLoading
                || (!quotaForm.useDefault && !quotaForm.dailyLimit.trim())
              }
            >
              {quotaSubmitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 拒绝/禁用对话框 */}
      <Dialog open={decisionDialog.open} onOpenChange={(open)=>{ if(!open) closeDecisionDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decisionDialog.mode === 'REJECT' ? '拒绝注册申请' : '禁用用户'}</DialogTitle>
            <DialogDescription>
              {decisionDialog.target ? `用户：${decisionDialog.target.username}` : '请选择用户'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {decisionDialog.error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2">
                {decisionDialog.error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="decisionReason" className="text-sm">
                {decisionDialog.mode === 'REJECT' ? '拒绝理由（可选）' : '禁用理由（可选）'}
              </Label>
              <Textarea
                id="decisionReason"
                value={decisionDialog.reason}
                onChange={(e)=>setDecisionDialog((prev)=>({ ...prev, reason: e.target.value }))}
                placeholder={decisionDialog.mode === 'REJECT' ? '说明拒绝原因，便于用户了解情况' : '可记录禁用原因，便于后续审计'}
                disabled={decisionDialog.submitting}
                maxLength={200}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">最多 200 字，可留空。</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDecisionDialog} disabled={decisionDialog.submitting}>
              取消
            </Button>
            <Button type="button" onClick={submitDecisionDialog} disabled={decisionDialog.submitting}>
              {decisionDialog.submitting ? '处理中...' : '确认'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
