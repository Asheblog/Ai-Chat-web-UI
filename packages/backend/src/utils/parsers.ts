/**
 * 通用解析工具函数库
 * 用于配置解析、类型转换等场景
 */

const TRUTHY_VALUES = new Set(['true', '1', 'yes', 'y', 'on'])
const FALSY_VALUES = new Set(['false', '0', 'no', 'n', 'off'])

/**
 * 解析布尔值配置
 * 支持多种字符串格式: true/false, 1/0, yes/no, y/n, on/off
 */
export const parseBooleanSetting = (value: string | undefined | null, fallback: boolean): boolean => {
  if (value === undefined || value === null) return fallback
  const normalized = value.toString().trim().toLowerCase()
  if (TRUTHY_VALUES.has(normalized)) return true
  if (FALSY_VALUES.has(normalized)) return false
  return fallback
}

/**
 * 解析域名列表配置
 * 支持 JSON 数组格式或逗号分隔格式
 */
export const parseDomainListSetting = (raw?: string | null): string[] => {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.map((d) => (typeof d === 'string' ? d.trim() : '')).filter(Boolean)
    }
  } catch {
    // 非 JSON 格式，按逗号分隔处理
  }
  return trimmed
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean)
}

/**
 * 解析数值配置，带范围限制
 */
export const parseNumberSetting = (
  value: string | undefined | null,
  options: {
    min?: number
    max?: number
    fallback: number
  },
): number => {
  const { min, max, fallback } = options
  if (value === undefined || value === null) return fallback
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  let result = parsed
  if (min !== undefined) result = Math.max(min, result)
  if (max !== undefined) result = Math.min(max, result)
  return result
}

/**
 * 解析浮点数配置，带范围限制
 */
export const parseFloatSetting = (
  value: string | undefined | null,
  options: {
    min?: number
    max?: number
    fallback: number
  },
): number => {
  const { min, max, fallback } = options
  if (value === undefined || value === null) return fallback
  const parsed = Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) return fallback
  let result = parsed
  if (min !== undefined) result = Math.max(min, result)
  if (max !== undefined) result = Math.min(max, result)
  return result
}

/**
 * 解析枚举值配置
 */
export const parseEnumSetting = <T extends string>(
  value: string | undefined | null,
  allowedValues: readonly T[],
  fallback: T,
): T => {
  if (value === undefined || value === null) return fallback
  const normalized = value.trim().toLowerCase() as T
  return allowedValues.includes(normalized) ? normalized : fallback
}

/**
 * 截断文本到指定长度
 */
export const truncateText = (text: string, limit = 160): string => {
  const normalized = (text || '').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized
}

/**
 * 限制数值到指定范围
 */
export const clampNumber = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value))
}
