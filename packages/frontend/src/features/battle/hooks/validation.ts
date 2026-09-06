const FORBIDDEN_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'connection',
  'transfer-encoding',
  'content-length',
  'accept-encoding',
])

export const normalizeThreshold = (value: string, fallback = 0.8): number => {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

export const normalizeInteger = (value: string, fallback: number, min: number, max: number): number => {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export const parseCustomBody = (raw: string): { value: Record<string, any> | undefined; error: string | null } => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { value: undefined, error: null }
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { value: undefined, error: '自定义请求体必须是 JSON 对象' }
    }
    return { value: parsed as Record<string, any>, error: null }
  } catch (error: any) {
    const message = error instanceof Error ? error.message : '自定义请求体解析失败'
    return { value: undefined, error: message }
  }
}

export const sanitizeHeaders = (
  headers: Array<{ name: string; value: string }>
): { ok: boolean; headers: Array<{ name: string; value: string }>; reason?: string } => {
  const sanitized: Array<{ name: string; value: string }> = []
  for (const item of headers) {
    const name = (item?.name || '').trim()
    const value = (item?.value || '').trim()
    if (!name && !value) continue
    if (!name) return { ok: false, reason: '请输入请求头名称', headers: [] }
    if (name.length > 64) return { ok: false, reason: '请求头名称需 ≤ 64 字符', headers: [] }
    if (value.length > 2048) return { ok: false, reason: '请求头值需 ≤ 2048 字符', headers: [] }
    const lower = name.toLowerCase()
    if (FORBIDDEN_HEADER_NAMES.has(lower) || lower.startsWith('proxy-') || lower.startsWith('sec-')) {
      return { ok: false, reason: '敏感或受保护的请求头无法覆盖，请更换名称', headers: [] }
    }
    const existingIdx = sanitized.findIndex((header) => header.name.toLowerCase() === lower)
    if (existingIdx >= 0) sanitized.splice(existingIdx, 1)
    if (!value) continue
    sanitized.push({ name, value })
  }
  return { ok: true, headers: sanitized }
}
