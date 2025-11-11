export type StatusFilter = 'ALL' | 'PENDING' | 'ACTIVE' | 'DISABLED'
export type DecisionMode = 'REJECT' | 'DISABLE'
export type ConfirmMode = 'APPROVE' | 'ENABLE' | 'CHANGE_ROLE' | 'DELETE'
export type SortField = 'username' | 'createdAt' | 'status'
export type SortOrder = 'asc' | 'desc'

type StatusMeta = {
  label: string
  className: string
}

export const STATUS_META: Record<'PENDING' | 'ACTIVE' | 'DISABLED', StatusMeta> = {
  PENDING: { label: '待审批', className: 'bg-blue-100/60 text-blue-700 border-blue-200' },
  ACTIVE: { label: '已启用', className: 'bg-emerald-100/60 text-emerald-700 border-emerald-200' },
  DISABLED: { label: '已禁用', className: 'bg-rose-100/60 text-rose-700 border-rose-200' },
}

export const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'ALL', label: '全部状态' },
  { value: 'PENDING', label: '待审批' },
  { value: 'ACTIVE', label: '已启用' },
  { value: 'DISABLED', label: '已禁用' },
]

export const formatTimestamp = (value?: string | null) => {
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
