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

export const handleUnauthorizedRedirect = () => {
  try {
    if (typeof window === 'undefined') return
    clearAuthPersistence()
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
