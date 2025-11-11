"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useToast } from "@/components/ui/use-toast"
import type { ActorQuota } from "@/types"
import {
  listUsers,
  getUserQuota as fetchUserQuotaApi,
  updateUserQuota as updateUserQuotaApi,
  approveUser as approveUserApi,
  rejectUser as rejectUserApi,
  updateUserStatus as updateUserStatusApi,
  deleteUser as deleteUserApi,
  updateUserRole as updateUserRoleApi,
  type SystemUserRow,
  type SystemUsersPageData,
} from "@/services/system-users"
import type { StatusFilter, DecisionMode, ConfirmMode, SortField, SortOrder } from "./constants"

export type QuotaFormState = { useDefault: boolean; dailyLimit: string; resetUsed: boolean }

export interface DecisionDialogState {
  open: boolean
  mode: DecisionMode
  target: SystemUserRow | null
  reason: string
  submitting: boolean
  error: string | null
}

export interface ConfirmDialogState {
  open: boolean
  mode: ConfirmMode | null
  target: SystemUserRow | null
  role?: 'ADMIN' | 'USER'
}

type LoadOptions = { page?: number; limit?: number; search?: string; status?: StatusFilter }

export function useSystemUsers() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<SystemUserRow[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [search, setSearch] = useState("")
  const [searchDraft, setSearchDraft] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [actionUserId, setActionUserId] = useState<number | null>(null)
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<SystemUserRow | null>(null)
  const [quotaSnapshot, setQuotaSnapshot] = useState<ActorQuota | null>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [quotaSubmitting, setQuotaSubmitting] = useState(false)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [quotaForm, setQuotaForm] = useState<QuotaFormState>({ useDefault: true, dailyLimit: "", resetUsed: false })

  const [decisionDialog, setDecisionDialog] = useState<DecisionDialogState>({
    open: false,
    mode: 'REJECT',
    target: null,
    reason: '',
    submitting: false,
    error: null,
  })

  const [confirmState, setConfirmState] = useState<ConfirmDialogState>({
    open: false,
    mode: null,
    target: null,
    role: undefined,
  })
  const [confirmLoading, setConfirmLoading] = useState(false)

  const load = useCallback(async (opts?: LoadOptions) => {
    setLoading(true)
    setError(null)
    try {
      const nextStatus = opts?.status ?? statusFilter
      const statusForQuery = nextStatus === 'ALL' ? undefined : nextStatus
      const data: SystemUsersPageData | null = await listUsers({
        page: opts?.page ?? page,
        limit: opts?.limit ?? limit,
        search: typeof opts?.search === 'string' ? opts?.search : search,
        status: statusForQuery,
      })
      setRows(data?.users || [])
      if (data?.pagination) {
        setPage(data.pagination.page)
        setLimit(data.pagination.limit)
        setTotalPages(data.pagination.totalPages)
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, page, limit, search])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = useCallback(() => load(), [load])

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

  const openQuotaDialog = async (row: SystemUserRow) => {
    setQuotaTarget(row)
    setQuotaDialogOpen(true)
    setQuotaLoading(true)
    setQuotaError(null)
    setQuotaSnapshot(null)
    setQuotaForm({ useDefault: true, dailyLimit: "", resetUsed: false })
    try {
      const quota = await fetchUserQuotaApi(row.id)
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
      setQuotaError(e?.response?.data?.error || e?.message || '获取用户额度失败')
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
      await updateUserQuotaApi(quotaTarget.id, {
        dailyLimit: resolvedDailyLimit,
        resetUsed: quotaForm.resetUsed || undefined,
      })
      toast({
        title: '额度已更新',
        description: quotaForm.useDefault ? '已恢复跟随全局默认额度' : `已设置每日额度为 ${resolvedDailyLimit}`,
      })
      handleQuotaDialogOpenChange(false)
      await load()
    } catch (e: any) {
      setQuotaError(e?.response?.data?.error || e?.message || '更新用户额度失败')
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

  const openDecisionDialog = (mode: DecisionMode, target: SystemUserRow) => {
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
        await rejectUserApi(decisionDialog.target.id, decisionDialog.reason)
        toast({ title: '已拒绝注册', description: `用户 ${decisionDialog.target.username} 已标记为禁用` })
      } else {
        await updateUserStatusApi(decisionDialog.target.id, 'DISABLED', decisionDialog.reason)
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

  const openConfirm = (mode: ConfirmMode, target: SystemUserRow, extras?: { role?: 'ADMIN' | 'USER' }) => {
    setConfirmState({ open: true, mode, target, role: extras?.role })
  }

  const closeConfirm = () => {
    if (confirmLoading) return
    setConfirmState({ open: false, mode: null, target: null, role: undefined })
  }

  const confirmApprove = (row: SystemUserRow) => openConfirm('APPROVE', row)
  const confirmEnable = (row: SystemUserRow) => openConfirm('ENABLE', row)
  const confirmChangeRole = (row: SystemUserRow, role: 'ADMIN' | 'USER') => openConfirm('CHANGE_ROLE', row, { role })
  const confirmDelete = (row: SystemUserRow) => openConfirm('DELETE', row)

  const runConfirmAction = async () => {
    if (!confirmState.mode || !confirmState.target) return
    setConfirmLoading(true)
    setActionUserId(confirmState.target.id)
    const username = confirmState.target.username
    try {
      switch (confirmState.mode) {
        case 'APPROVE':
          await approveUserApi(confirmState.target.id)
          toast({ title: '审批通过', description: `用户 ${username} 已可登录` })
          break
        case 'ENABLE':
          await updateUserStatusApi(confirmState.target.id, 'ACTIVE')
          toast({ title: '已启用用户', description: `用户 ${username} 可以重新登录` })
          break
        case 'CHANGE_ROLE': {
          const role = confirmState.role
          if (!role) throw new Error('缺少角色参数')
          await updateUserRoleApi(confirmState.target.id, role)
          toast({ title: '已更新用户角色', description: role === 'ADMIN' ? '已设为管理员' : '已设为普通用户' })
          break
        }
        case 'DELETE':
          await deleteUserApi(confirmState.target.id)
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

  const toggleSelectAll = () => {
    if (selectedIds.size === sortedRows.length && sortedRows.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(sortedRows.map((r) => r.id)))
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

  const handleBatchEnable = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setLoading(true)
    try {
      await Promise.all(ids.map((id) => updateUserStatusApi(id, 'ACTIVE')))
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
    if (ids.length === 0) return
    setLoading(true)
    try {
      await Promise.all(ids.map((id) => updateUserStatusApi(id, 'DISABLED')))
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
    if (ids.length === 0) return
    setLoading(true)
    try {
      await Promise.all(ids.map((id) => deleteUserApi(id)))
      toast({ title: '批量删除成功', description: `已删除 ${ids.length} 个用户` })
      setSelectedIds(new Set())
      await load()
    } catch (e: any) {
      toast({ title: '批量删除失败', description: e?.message || '操作失败', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const changePageSize = (nextLimit: number) => {
    const safeLimit = Number.isFinite(nextLimit) && nextLimit > 0 ? nextLimit : 10
    setLimit(safeLimit)
    setPage(1)
    load({ page: 1, limit: safeLimit, status: statusFilter })
  }

  const goToPage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(totalPages || 1, nextPage))
    setPage(safePage)
    load({ page: safePage, status: statusFilter })
  }

  const pagination = useMemo(() => ({ page, limit, totalPages }), [page, limit, totalPages])

  const updateDecisionReason = (reason: string) => {
    setDecisionDialog((prev) => ({ ...prev, reason }))
  }

  return {
    loading,
    error,
    rows,
    sortedRows,
    pagination,
    search,
    searchDraft,
    setSearchDraft,
    statusFilter,
    sortField,
    sortOrder,
    selectedIds,
    quotaDialogOpen,
    quotaTarget,
    quotaSnapshot,
    quotaLoading,
    quotaSubmitting,
    quotaError,
    quotaForm,
    decisionDialog,
    confirmState,
    confirmLoading,
    confirmMeta,
    actionUserId,
    refresh,
    onSearch,
    onClearSearch,
    handleStatusFilterChange,
    toggleSort,
    toggleSelectAll,
    toggleSelectRow,
    handleBatchEnable,
    handleBatchDisable,
    handleBatchDelete,
    clearSelection: () => setSelectedIds(new Set()),
    openQuotaDialog,
    handleQuotaDialogOpenChange,
    setQuotaForm,
    handleQuotaSave,
    openDecisionDialog,
    closeDecisionDialog,
    submitDecisionDialog,
    updateDecisionReason,
    confirmApprove,
    confirmEnable,
    confirmChangeRole,
    confirmDelete,
    closeConfirm,
    runConfirmAction,
    changePageSize,
    goToPage,
  }
}
