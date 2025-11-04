import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date): string {
  const d = new Date(date)
  const now = new Date()
  const diffInHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60)

  if (diffInHours < 24) {
    return d.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    })
  } else if (diffInHours < 24 * 7) {
    return d.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric'
    })
  } else {
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }
}

export function generateSessionTitle(firstMessage: string): string {
  // 提取前50个字符作为标题
  const title = firstMessage.trim().slice(0, 50)
  return title.length === 50 ? title + '...' : title
}

export function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    return navigator.clipboard.writeText(text)
  }

  if (typeof document === 'undefined') {
    return Promise.reject(new Error('无法在当前环境访问剪贴板'))
  }

  // 降级方案（仅限浏览器环境）
  const textArea = document.createElement('textarea')
  textArea.value = text
  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()
  return new Promise((resolve, reject) => {
    try {
      document.execCommand('copy')
      document.body.removeChild(textArea)
      resolve()
    } catch (err) {
      document.body.removeChild(textArea)
      reject(err)
    }
  })
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout
  return (...args: Parameters<T>) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

export function isValidUrl(string: string): boolean {
  try {
    new URL(string)
    return true
  } catch (_) {
    return false
  }
}

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '发生未知错误'
}

const CHANNEL_PREFIX_BLACKLIST = new Set(['api', 'app', 'prod', 'dev', 'test', 'staging', 'stage', 'ai', 'llm', 'model', 'models', 'gateway', 'gw'])
const GENERIC_TLDS = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ai', 'io', 'app', 'dev', 'cn', 'uk'])

function parseUrlCandidate(input?: string): URL | null {
  if (!input) return null
  const tryParse = (value: string): URL | null => {
    try {
      return new URL(value)
    } catch {
      return null
    }
  }
  const direct = tryParse(input)
  if (direct) return direct
  if (!/^https?:\/\//i.test(input)) {
    return tryParse(`https://${input}`)
  }
  return null
}

export function deriveChannelName(provider: string, baseUrl?: string): string {
  const fallback = provider
  const parsed = parseUrlCandidate(baseUrl)
  if (!parsed) return fallback

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return fallback

  let parts = hostname.split('.').filter(Boolean)
  if (parts.length > 1 && CHANNEL_PREFIX_BLACKLIST.has(parts[0])) {
    parts = parts.slice(1)
  }

  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0]

  let candidate = parts[parts.length - 2]
  if (GENERIC_TLDS.has(candidate) && parts.length >= 3) {
    candidate = parts[parts.length - 3]
  }

  candidate = candidate || parts[parts.length - 1]
  if (!candidate || candidate.length < 2) return fallback
  return candidate
}
