const loadedAvatarUrls = new Set<string>()
const avatarPreloadTasks = new Map<string, Promise<boolean>>()

export type AvatarLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error'

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

export const isAvatarImageLoaded = (url?: string | null) => {
  const normalized = normalizeAvatarUrl(url)
  return normalized.length > 0 && loadedAvatarUrls.has(normalized)
}

export const markAvatarImageLoaded = (url?: string | null, loaded = true) => {
  const normalized = normalizeAvatarUrl(url)
  if (!normalized) return
  if (loaded) {
    loadedAvatarUrls.add(normalized)
    return
  }
  loadedAvatarUrls.delete(normalized)
}

export const syncAvatarLoadingStatus = (
  url: string | null | undefined,
  status: AvatarLoadingStatus,
) => {
  if (status === 'loaded') {
    markAvatarImageLoaded(url, true)
  } else if (status === 'error') {
    markAvatarImageLoaded(url, false)
  }
}

export const preloadAvatarImage = async (url?: string | null): Promise<boolean> => {
  const normalized = normalizeAvatarUrl(url)
  if (!normalized) return false
  if (loadedAvatarUrls.has(normalized)) return true

  const inFlight = avatarPreloadTasks.get(normalized)
  if (inFlight) return inFlight

  if (typeof window === 'undefined') return false

  const task = new Promise<boolean>((resolve) => {
    const image = new window.Image()
    image.decoding = 'async'
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = normalized
  }).then((loaded) => {
    avatarPreloadTasks.delete(normalized)
    if (loaded) {
      loadedAvatarUrls.add(normalized)
    }
    return loaded
  })

  avatarPreloadTasks.set(normalized, task)
  return task
}
