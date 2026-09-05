import { type ClassValue, clsx } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-micro",
        "text-caption",
        "text-title-s",
        "text-title-m",
        "text-title-l",
        "text-display",
        "text-display-lg",
      ],
    },
  },
})

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

const fallbackCopy = (text: string): Promise<void> => {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('无法在当前环境访问剪贴板'))
  }
  const textArea = document.createElement('textarea')
  textArea.value = text
  
  // 设置样式使 textarea 不可见但仍可被选中（移动端兼容性关键）
  textArea.style.position = 'fixed'
  textArea.style.top = '0'
  textArea.style.left = '0'
  textArea.style.width = '2em'
  textArea.style.height = '2em'
  textArea.style.padding = '0'
  textArea.style.border = 'none'
  textArea.style.outline = 'none'
  textArea.style.boxShadow = 'none'
  textArea.style.background = 'transparent'
  textArea.style.opacity = '0'
  textArea.style.zIndex = '-1'
  // 防止移动端键盘弹出和页面缩放
  textArea.setAttribute('readonly', '')
  textArea.setAttribute('contenteditable', 'true')
  
  document.body.appendChild(textArea)
  
  // 移动端兼容：使用 setSelectionRange 替代 select()
  textArea.focus()
  textArea.setSelectionRange(0, text.length)
  
  return new Promise((resolve, reject) => {
    try {
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      if (successful) {
        resolve()
      } else {
        reject(new Error('execCommand 复制失败'))
      }
    } catch (err) {
      document.body.removeChild(textArea)
      reject(err)
    }
  })
}

export function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  }
  return fallbackCopy(text)
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

// 渠道名推导已收敛至 @aichat/shared/model-display（backend / frontend 共用）。
export { deriveChannelName } from '@aichat/shared/model-display'
