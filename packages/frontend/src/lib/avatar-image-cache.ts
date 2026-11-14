const avatarPreloadTasks = new Map<string, Promise<boolean>>()

export const normalizeAvatarUrl = (value?: string | null) => {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) return ''
  if (typeof window === 'undefined') return normalized

  // HTTPS 页面下统一升级头像 URL，避免 mixed-content 导致的重复重试与额外开销。
  if (window.location.protocol === 'https:' && /^http:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized)
      return `https://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      return normalized.replace(/^http:\/\//i, 'https://')
    }
  }

  return normalized
}

/**
 * 把头像预热进浏览器缓存。
 *
 * Radix Avatar 的探测图在设置 `src` 后会同步读取 `complete/naturalWidth`，命中缓存时
 * 当帧就是 `loaded`，气泡挂载即可直接出图。这里只做 in-flight 去重，不维护「已加载」全局
 * 状态——那个状态只说明某个 URL 曾被别处加载过，与当前元素能否绘制无关。
 */
export const preloadAvatarImage = async (url?: string | null): Promise<boolean> => {
  const normalized = normalizeAvatarUrl(url)
  if (!normalized) return false
  if (typeof window === 'undefined') return false

  const inFlight = avatarPreloadTasks.get(normalized)
  if (inFlight) return inFlight

  const task = new Promise<boolean>((resolve) => {
    const image = new window.Image()
    image.decoding = 'async'
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = normalized
  }).finally(() => {
    avatarPreloadTasks.delete(normalized)
  })

  avatarPreloadTasks.set(normalized, task)
  return task
}
