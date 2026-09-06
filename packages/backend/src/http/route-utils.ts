/**
 * Hono 路由公共工具。
 *
 * 收敛 api/*.ts 中重复的 parsePagination / parseId / handleError 样板。
 */
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const parsePagination = (
  value: string | null | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value || '', 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }
  return fallback
}

export const parsePositiveIntParam = (
  value: string | null | undefined,
): number | null => {
  const parsed = Number.parseInt(value || '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

type StatusCodeError = Error & { statusCode: number }

export const handleRouteError = (
  c: Context,
  error: unknown,
  fallbackMessage: string,
  logLabel?: string,
) => {
  if (error instanceof Error && typeof (error as StatusCodeError).statusCode === 'number') {
    return c.json(
      { success: false, error: error.message },
      (error as StatusCodeError).statusCode as ContentfulStatusCode,
    )
  }
  console.error(logLabel ?? fallbackMessage, error)
  return c.json({ success: false, error: fallbackMessage }, 500)
}
