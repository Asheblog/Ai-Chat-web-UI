/**
 * 头像 URL 工具：只做 URL 规范化与预热去重，**不保存**「某个 URL 已加载」这类渲染状态。
 *
 * 渲染是否就绪由 Radix Avatar 自己的探测图决定（命中缓存时它会在同一帧返回 loaded），
 * 用全局标志去控制占位可见性只会制造与元素实际状态脱节的空圈。
 */
const avatarPreloadTasks = new Map<string, Promise<void>>()

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
export const preloadAvatarImage = async (url?: string | null): Promise<void> => {
  const normalized = normalizeAvatarUrl(url)
  if (!normalized) return
  if (typeof window === 'undefined') return

  const inFlight = avatarPreloadTasks.get(normalized)
  if (inFlight) return inFlight

  const task = new Promise<void>((resolve) => {
    const image = new window.Image()
    image.decoding = 'async'
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = normalized
  }).finally(() => {
    avatarPreloadTasks.delete(normalized)
  })

  avatarPreloadTasks.set(normalized, task)
  return task
}
