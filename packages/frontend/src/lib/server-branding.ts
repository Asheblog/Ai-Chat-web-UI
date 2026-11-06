'use server'

import {
  BRAND_THEME_STORAGE_KEYS,
  type BrandThemeColors,
} from '@aichat/shared'
import type { ApiResponse } from '@/types'

const DEFAULT_BRAND = 'AIChat'
const BRANDING_DEADLINE_MS = 1500
const BRANDING_REVALIDATE_SECONDS = (() => {
  const raw = process.env.BRANDING_REVALIDATE_SECONDS
  const parsed = raw ? Number.parseInt(raw, 10) : null
  if (parsed !== null && Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  // 默认 60s：站点名/品牌信息在管理面板修改后 1 分钟内刷新，
  // 同时保留 SSR 缓存避免每次请求都打到后端
  return 60
})()
const IS_PRODUCTION_BUILD_PHASE = process.env.NEXT_PHASE === 'phase-production-build'
const BRANDING_FETCH_DISABLED = IS_PRODUCTION_BUILD_PHASE || process.env.BRANDING_FETCH_DISABLED === '1'

const buildBrandingEndpoint = () => {
  const publicApi = process.env.NEXT_PUBLIC_API_URL
  if (publicApi && /^https?:\/\//i.test(publicApi)) {
    return `${publicApi.replace(/\/$/, '')}/settings/branding`
  }
  const backendHost = process.env.BACKEND_HOST || 'localhost'
  const backendPort = process.env.BACKEND_INTERNAL_PORT || process.env.BACKEND_PORT || '8001'
  return `http://${backendHost}:${backendPort}/api/settings/branding`
}

type PublicBrandingPayload = {
  brand_text?: string
} & Partial<Record<(typeof BRAND_THEME_STORAGE_KEYS)[number], string | null | undefined>>

const mapBrandTheme = (data?: PublicBrandingPayload | null): BrandThemeColors => {
  const theme: BrandThemeColors = {}
  if (!data) return theme
  for (const key of BRAND_THEME_STORAGE_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) {
      theme[key] = value.trim()
    }
  }
  return theme
}

export interface ServerBrandingResult {
  text: string
  theme: BrandThemeColors
  isFallback: boolean
}

const fallbackResult = (): ServerBrandingResult => ({ text: DEFAULT_BRAND, theme: {}, isFallback: true })

type BrandingFailureCategory = 'fetch_timeout' | 'fetch_error' | 'http_status' | 'invalid_payload'

const warnFallback = (category: BrandingFailureCategory, status?: number) => {
  // 固定类别与状态码，不输出请求地址、响应体或凭据。
  console.warn('[branding] fallback', status ? { category, status } : { category })
}

/**
 * 模块级并发合并：品牌是公共数据、无用户态，同一进程内并发请求可共享一次上游读取。
 * 仅在 Promise 未结算期间生效，结算后立即清空；不构成跨请求结果缓存。
 */
let requestInFlight: Promise<ServerBrandingResult> | null = null

const createAbortError = () => {
  const error = new Error('branding request aborted')
  error.name = 'AbortError'
  return error
}

const readJsonUntilAborted = <T>(response: Response, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError())
      return
    }

    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(createAbortError())
    }

    signal.addEventListener('abort', onAbort, { once: true })
    response.json().then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value as T)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })

const fetchBranding = async (): Promise<ServerBrandingResult> => {
  const endpoint = buildBrandingEndpoint()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      // 同一 deadline 释放 fetch 及其响应体读取，避免悬挂请求继续占用连接。
      controller.abort()
      reject(new Error('branding deadline exceeded'))
    }, BRANDING_DEADLINE_MS)
  })

  const request = (async (): Promise<ServerBrandingResult> => {
    const fetchOptions: RequestInit & { next?: { revalidate?: number } } = {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }
    if (BRANDING_REVALIDATE_SECONDS === 0) {
      fetchOptions.cache = 'no-store'
    } else {
      fetchOptions.next = { revalidate: BRANDING_REVALIDATE_SECONDS }
    }

    const response = await fetch(endpoint, fetchOptions)
    if (!response.ok) {
      warnFallback('http_status', response.status)
      return fallbackResult()
    }

    // json() 也必须受同一 deadline 约束，响应头返回不代表响应体可用。
    const payload = await readJsonUntilAborted<ApiResponse<PublicBrandingPayload>>(
      response,
      controller.signal,
    )
    if (!payload || typeof payload !== 'object') {
      warnFallback('invalid_payload')
      return fallbackResult()
    }
    const theme = mapBrandTheme(payload.data)
    const resolved = (payload.data?.brand_text || '').trim()
    if (resolved) {
      return { text: resolved, theme, isFallback: false }
    }
    return { text: DEFAULT_BRAND, theme, isFallback: true }
  })()

  try {
    return await Promise.race([request, deadline])
  } catch {
    if (timedOut) {
      warnFallback('fetch_timeout')
    } else {
      warnFallback('fetch_error')
    }
    return fallbackResult()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export const getServerBranding = async (): Promise<ServerBrandingResult> => {
  if (BRANDING_FETCH_DISABLED) {
    return fallbackResult()
  }
  // 并发合并只覆盖未结算的公共品牌读取；成功后仍由 fetch 的 revalidate 策略管理缓存。
  if (requestInFlight) return requestInFlight
  requestInFlight = fetchBranding()
  try {
    return await requestInFlight
  } finally {
    requestInFlight = null
  }
}

export const getServerBrandText = async (): Promise<string> => {
  const { text } = await getServerBranding()
  return text
}
