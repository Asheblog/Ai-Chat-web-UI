"use client"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { apiClient } from "@/lib/api"
import { useToast } from "@/components/ui/use-toast"
import type { ActorQuota } from "@/types"

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

  const approveUser = async (row: UserRow) => {
    if (!confirm(`确认审批通过 “${row.username}”？`)) return
    setActionUserId(row.id)
    try {
      await apiClient.approveUser(row.id)
      toast({ title: '审批通过', description: `用户 ${row.username} 已可登录` })
      await load()
    } catch (e: any) {
      toast({ title: '审批失败', description: e?.response?.data?.error || e?.message || '审批失败', variant: 'destructive' })
    } finally {
      setActionUserId(null)
    }
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

  const enableUser = async (row: UserRow) => {
    if (!confirm(`确认启用用户 “${row.username}”？`)) return
    setActionUserId(row.id)
    try {
      await apiClient.updateUserStatus(row.id, 'ACTIVE')
      toast({ title: '已启用用户', description: `用户 ${row.username} 可以重新登录` })
      await load()
    } catch (e: any) {
      toast({ title: '启用失败', description: e?.response?.data?.error || e?.message || '启用失败', variant: 'destructive' })
    } finally {
      setActionUserId(null)
    }
  }

  const changeRole = async (row: UserRow, role: 'ADMIN'|'USER') => {
    if (!confirm(`确认将用户 “${row.username}” 角色变更为 ${role}?`)) return
    setActionUserId(row.id)
    try {
      await apiClient.updateUserRole(row.id, role)
      toast({ title: '已更新用户角色' })
      await load()
    } catch (e:any) {
      toast({ title: '更新失败', description: e?.response?.data?.error || e?.message || '更新失败', variant: 'destructive' })
    } finally {
      setActionUserId(null)
    }
  }

  const deleteUser = async (row: UserRow) => {
    if (!confirm(`确认删除用户 “${row.username}”? 该操作不可恢复，将级联删除其会话/消息。`)) return
    setActionUserId(row.id)
    try {
      await apiClient.deleteUser(row.id)
      toast({ title: '已删除用户' })
      // 若当前页为空则回退一页
      await load()
    } catch (e:any) {
      toast({ title: '删除失败', description: e?.response?.data?.error || e?.message || '删除失败', variant: 'destructive' })
    } finally {
      setActionUserId(null)
    }
  }

  const pagination = useMemo(() => ({ page, limit, totalPages }), [page, limit, totalPages])

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-base font-medium">用户管理</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
            <Input
              placeholder="搜索用户名"
              value={searchDraft}
              onChange={(e)=>setSearchDraft(e.target.value)}
              className="w-full sm:w-56"
              onKeyDown={(e)=>{ if(e.key==='Enter') onSearch() }}
            />
            <Button variant="outline" onClick={onSearch} disabled={loading} className="w-full sm:w-auto">搜索</Button>
            {search && (
              <Button variant="ghost" onClick={onClearSearch} disabled={loading} className="w-full sm:w-auto">
                清空
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground whitespace-nowrap">状态</Label>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(e)=>handleStatusFilterChange(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <Button variant="outline" onClick={()=>load()} disabled={loading} className="w-full sm:w-auto">刷新</Button>
        </div>
      </div>

      {error && <div className="text-sm text-destructive">{error}</div>}

      <div className="border rounded overflow-x-auto">
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="text-center whitespace-nowrap w-[120px]">用户名</TableHead>
              <TableHead className="text-center whitespace-nowrap w-[120px]">角色</TableHead>
              <TableHead className="text-center whitespace-nowrap w-[120px]">状态</TableHead>
              <TableHead className="text-center whitespace-nowrap w-[140px]">创建时间</TableHead>
              <TableHead className="text-center whitespace-nowrap w-[320px]">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">加载中...</TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">暂无数据</TableCell></TableRow>
            )}
            {rows.map((r) => {
              const statusInfo = STATUS_META[r.status]
              const statusTitle = r.status === 'DISABLED'
                ? (r.rejectionReason ? `禁用原因：${r.rejectionReason}` : '账户已被禁用')
                : r.status === 'PENDING'
                  ? '等待管理员审批'
                  : '账户已启用'
              const isActionBusy = actionUserId === r.id || loading
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-center whitespace-nowrap">{r.username}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${r.role==='ADMIN' ? 'bg-amber-100/30 border-amber-300 text-amber-700' : 'bg-muted/40 border-muted-foreground/20 text-muted-foreground'}`}>{r.role}</span>
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${statusInfo.className}`}
                      title={statusTitle}
                    >
                      {statusInfo.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">
                    <div className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground min-w-[120px]">
                      <span>{formatTimestamp(r.createdAt)}</span>
                      {r.approvedAt && <span>批：{formatTimestamp(r.approvedAt)}</span>}
                      {!r.approvedAt && r.rejectedAt && <span>禁：{formatTimestamp(r.rejectedAt)}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2 max-w-[320px] mx-auto">
                      <Button size="sm" variant="outline" onClick={()=>openQuotaDialog(r)} disabled={quotaSubmitting || isActionBusy} className="px-3 py-2 text-sm w-full">调整额度</Button>
                      {r.status === 'PENDING' && (
                        <>
                          <Button size="sm" variant="outline" onClick={()=>approveUser(r)} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">审批通过</Button>
                          <Button size="sm" variant="destructive" onClick={()=>openDecisionDialog('REJECT', r)} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">拒绝</Button>
                        </>
                      )}
                      {r.status === 'ACTIVE' && (
                        <Button size="sm" variant="destructive" onClick={()=>openDecisionDialog('DISABLE', r)} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">禁用</Button>
                      )}
                      {r.status === 'DISABLED' && (
                        <Button size="sm" variant="outline" onClick={()=>enableUser(r)} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">启用</Button>
                      )}
                      {r.role !== 'ADMIN' && (
                        <Button size="sm" variant="outline" onClick={()=>changeRole(r, 'ADMIN')} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">设为管理员</Button>
                      )}
                      {r.role !== 'USER' && (
                        <Button size="sm" variant="outline" onClick={()=>changeRole(r, 'USER')} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">设为用户</Button>
                      )}
                      <Button size="sm" variant="destructive" onClick={()=>deleteUser(r)} disabled={isActionBusy} className="px-3 py-2 text-sm w-full">删除</Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between text-sm">
        <div className="text-muted-foreground">第 {pagination.page} / {pagination.totalPages} 页</div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            <Button variant="outline" size="sm" disabled={page<=1 || loading} onClick={()=>{ const p=Math.max(1,page-1); setPage(p); load({ page: p, status: statusFilter }) }} className="w-full sm:w-auto">上一页</Button>
            <Button variant="outline" size="sm" disabled={page>=totalPages || loading} onClick={()=>{ const p=Math.min(totalPages,page+1); setPage(p); load({ page: p, status: statusFilter }) }} className="w-full sm:w-auto">下一页</Button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-muted-foreground">每页</Label>
            <select className="border rounded px-2 py-1" value={limit} onChange={(e)=>{ const l = parseInt(e.target.value)||10; setLimit(l); setPage(1); load({ page:1, limit:l, status: statusFilter }) }}>
              {[10,20,50].map(n => (<option key={n} value={n}>{n}</option>))}
            </select>
          </div>
        </div>
      </div>

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
