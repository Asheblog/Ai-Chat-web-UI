export const statusLabels: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  error: '失败',
  cancelled: '已取消',
}

export const formatDateTime = (value?: string | Date | null) => {
  if (!value) return '-'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(value))
  } catch {
    return String(value)
  }
}

export const formatDuration = (ms?: number | null) => {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m${remain}s`
}
