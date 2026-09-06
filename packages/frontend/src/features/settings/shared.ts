/**
 * 系统设置页共享工具函数。
 *
 * 收敛多份设置页内联副本：
 * - parseNumericInput（SystemNetwork / SystemRAG / SystemWebSearch ×3 相同实现）
 * - formatFileSize / formatDateTime 已收敛至 @/lib/format，此处兼容再导出
 */
export { formatDateTime, formatFileSize } from '@/lib/format'

export const parseNumericInput = (value: string, fallback: number) => {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}
