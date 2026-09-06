/**
 * 前端通用格式化工具。
 *
 * 收敛多处重复实现：
 * - formatFileSize：settings/shared、composer-attachment-list、message-bubble、system-log-card
 * - formatDateTime：settings/shared、task-trace
 * - formatDurationMs / formatDurationSeconds：message-bubble/message-metrics
 * - formatDuration：task-trace
 */

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const formatDateTime = (value?: string | Date | null): string => {
  if (!value) return '-'
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const normalizeMetricNumber = (value?: number | null) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export const normalizeMetricMs = (value?: number | null) => {
  const normalized = normalizeMetricNumber(value)
  return normalized == null ? null : Math.max(0, Math.round(normalized))
}

export const formatDurationMs = (value?: number | null) => {
  const durationMs = normalizeMetricMs(value)
  if (durationMs == null) return null
  if (durationMs < 1000) return `${durationMs}ms`

  const seconds = durationMs / 1000
  if (seconds < 10) return `${seconds.toFixed(2)}s`
  if (seconds < 60) return `${seconds.toFixed(1)}s`

  const totalSeconds = Math.round(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h${minutes > 0 ? `${minutes}m` : ''}${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`
  }

  return `${minutes}m${remainingSeconds > 0 ? `${remainingSeconds}s` : ''}`
}

export const formatDurationSeconds = (value?: number | null) => {
  const seconds = normalizeMetricNumber(value)
  return seconds == null ? null : formatDurationMs(seconds * 1000)
}

/** TaskTrace 控制台使用的紧凑耗时格式。 */
export const formatDuration = (ms?: number | null) => {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '-'
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remain = seconds % 60
  return `${minutes}m${remain}s`
}
