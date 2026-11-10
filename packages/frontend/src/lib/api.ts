import type { AxiosInstance } from 'axios'
import { createHttpClient } from '@/lib/http/client'

let redirecting = false

const clearAuthPersistence = () => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem('auth-storage')
  } catch {
    // ignore
  }
}

const AUTH_PAGES = ['/auth/login', '/auth/register']

/** 已经在登录/注册页时不再跳转，避免启动探针 401 造成整页刷新死循环 */
export const shouldRedirectToLogin = (pathname: string): boolean =>
  !AUTH_PAGES.some((page) => pathname.startsWith(page))

export const handleUnauthorizedRedirect = () => {
  try {
    if (typeof window === 'undefined') return
    clearAuthPersistence()
    if (!shouldRedirectToLogin(window.location.pathname)) return
    if (!redirecting) {
      redirecting = true
      window.location.href = '/auth/login'
    }
  } catch {
    // ignore redirect errors
  }
}

const createApiHttpClient = (): AxiosInstance =>
  createHttpClient(
    {},
    {
      onUnauthorized: handleUnauthorizedRedirect,
    },
  )

export const apiHttpClient = createApiHttpClient()
