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
