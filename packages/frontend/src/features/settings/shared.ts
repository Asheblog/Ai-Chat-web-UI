/**
 * 系统设置页共享工具函数。
 *
 * 收敛多份设置页内联副本：
 * - parseNumericInput（SystemNetwork / SystemRAG / SystemWebSearch ×3 相同实现）
 * - formatFileSize（SystemKnowledgeBase / SystemRAG ×2）
 * - formatDateTime（SystemKnowledgeBase / SystemRAG ×2 绝对时间版；
 *   system-skills 的 SkillApprovalsSection/SkillVersionSection/SystemSkillAudits ×3 可空容忍版，
 *   统一为一个可空容忍实现，null/非法输入渲染占位符）
 */
export const parseNumericInput = (value: string, fallback: number) => {
  const trimmed = value.trim()
  if (trimmed === '') return 0
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const formatDateTime = (value: string | Date | null | undefined) => {
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
