const MAX_CACHE_ENTRIES = 512

const cache = new Map<string, string>()

export const DATE_FORMAT_CACHE_LIMIT = MAX_CACHE_ENTRIES

const TIME_ZONE_CACHE_TTL_MS = 60_000

let cachedTimeZone: string | null = null
let cachedTimeZoneAt = 0

/**
 * 时区标识在会话内通常稳定；缓存一分钟避免每行每次格式化都构造 Intl。
 * 只缓存标识、不缓存格式化结果，DST 切换后的显示仍由每次 Date 计算决定。
 */
const resolveTimeZone = (): string => {
  const now = Date.now()
  if (cachedTimeZone !== null && now - cachedTimeZoneAt < TIME_ZONE_CACHE_TTL_MS) {
    return cachedTimeZone
  }
  try {
    cachedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  } catch {
    cachedTimeZone = 'local'
  }
  cachedTimeZoneAt = now
  return cachedTimeZone
}

/** 测试或系统时区切换后可主动失效。 */
export const resetTimeZoneCache = (): void => {
  cachedTimeZone = null
  cachedTimeZoneAt = 0
  sidebarFormatter = null
  sidebarFormatterZone = null
}

const remember = (key: string, value: string): string => {
  if (cache.has(key)) cache.delete(key)
  cache.set(key, value)
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return value
}

export const formatCachedDateTime = (time: number, locale = 'zh-CN'): string => {
  const key = `datetime:${locale}:${resolveTimeZone()}:${time}`
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  return remember(key, new Date(time).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }))
}

let sidebarFormatter: Intl.DateTimeFormat | null = null
let sidebarFormatterZone: string | null = null

const resolveSidebarFormatter = (timeZone: string): Intl.DateTimeFormat => {
  if (sidebarFormatter && sidebarFormatterZone === timeZone) return sidebarFormatter
  const baseOptions: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }
  // 无法解析时区时缓存值是 'local'，它不是合法 IANA 标识，交给运行时默认时区。
  sidebarFormatter = new Intl.DateTimeFormat(
    'zh-CN',
    timeZone && timeZone !== 'local' ? { ...baseOptions, timeZone } : baseOptions,
  )
  sidebarFormatterZone = timeZone
  return sidebarFormatter
}

/** 侧栏固定「月/日 时:分」；格式化器与缓存均复用，避免每行新建 Intl 实例。 */
export const formatCachedSidebarDateTime = (time: number): string => {
  const timeZone = resolveTimeZone()
  const key = `sidebar:${timeZone}:${time}`
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  return remember(key, resolveSidebarFormatter(timeZone).format(new Date(time)))
}

export const formatCachedDate = (time: number, now: number, locale = 'zh-CN'): string => {
  const diffInHours = (now - time) / (1000 * 60 * 60)
  // 结果只取决于相对阈值所在区间，而不是自然日；同一天内跨越 24h/7d
  // 必须换用不同缓存键，否则会继续返回上一个区间的文案。
  const bucket = diffInHours < 24 ? 'recent' : diffInHours < 24 * 7 ? 'week' : 'older'
  const key = `date:${locale}:${resolveTimeZone()}:${bucket}:${time}`
  const cached = cache.get(key)
  if (cached !== undefined) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }

  const date = new Date(time)
  let value: string
  if (diffInHours < 24) {
    value = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  } else if (diffInHours < 24 * 7) {
    value = date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  } else {
    value = date.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  return remember(key, value)
}

export const clearDateFormatCache = (): void => {
  cache.clear()
}

export const getDateFormatCacheSize = (): number => cache.size
