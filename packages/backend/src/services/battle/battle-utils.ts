import { clamp } from './battle-normalizers'

export const DEFAULT_JUDGE_THRESHOLD = 0.8

export const normalizeJudgeThreshold = (value?: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_JUDGE_THRESHOLD
  return clamp(value, 0, 1)
}

export const normalizeConcurrency = (value?: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 3
  return Math.min(6, Math.max(1, Math.floor(value)))
}

export const normalizePagination = (params?: {
  page?: number
  limit?: number
}): { page: number; limit: number } => {
  const page = typeof params?.page === 'number' && params.page > 0 ? Math.trunc(params.page) : 1
  const limit =
    typeof params?.limit === 'number' && params.limit > 0
      ? Math.min(Math.trunc(params.limit), 100)
      : 20
  return { page, limit }
}

export const computeExpiry = (expiresInHours?: number | null): Date | null => {
  if (!expiresInHours || !Number.isFinite(expiresInHours) || expiresInHours <= 0) {
    return null
  }
  const now = new Date()
  return new Date(now.getTime() + Math.floor(expiresInHours * 3600_000))
}
