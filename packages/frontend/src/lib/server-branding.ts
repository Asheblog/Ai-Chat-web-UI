'use server'

import type { ApiResponse } from '@/types'

const DEFAULT_BRAND = 'AIChat'
const BRANDING_REVALIDATE_SECONDS = (() => {
  const raw = process.env.BRANDING_REVALIDATE_SECONDS
  const parsed = raw ? Number.parseInt(raw, 10) : null
  if (parsed !== null && Number.isFinite(parsed) && parsed >= 0) {
    return parsed
  }
  return 300
})()
const BRANDING_FETCH_DISABLED = process.env.BRANDING_FETCH_DISABLED === '1'

const buildBrandingEndpoint = () => {
  const publicApi = process.env.NEXT_PUBLIC_API_URL
  if (publicApi && /^https?:\/\//i.test(publicApi)) {
    return `${publicApi.replace(/\/$/, '')}/settings/branding`
  }
  const backendHost = process.env.BACKEND_HOST || 'localhost'
  const backendPort = process.env.BACKEND_INTERNAL_PORT || process.env.BACKEND_PORT || '8001'
  return `http://${backendHost}:${backendPort}/api/settings/branding`
}

export interface ServerBrandingResult {
  text: string
  isFallback: boolean
}

export const getServerBranding = async (): Promise<ServerBrandingResult> => {
  if (BRANDING_FETCH_DISABLED) {
    return { text: DEFAULT_BRAND, isFallback: true }
  }

  const endpoint = buildBrandingEndpoint()
  try {
    const fetchOptions: RequestInit & { next?: { revalidate?: number } } = {
      headers: { Accept: 'application/json' },
    }
    if (BRANDING_REVALIDATE_SECONDS === 0) {
      fetchOptions.cache = 'no-store'
    } else {
      fetchOptions.next = { revalidate: BRANDING_REVALIDATE_SECONDS }
    }

    const response = await fetch(endpoint, fetchOptions)
    if (!response.ok) {
      throw new Error(`Branding request failed with status ${response.status}`)
    }
    const payload = (await response.json()) as ApiResponse<{ brand_text?: string }>
    const resolved = (payload.data?.brand_text || '').trim()
    if (resolved) {
      return { text: resolved, isFallback: false }
    }
    return { text: DEFAULT_BRAND, isFallback: true }
  } catch (error) {
    console.warn('[branding] fallback to default due to error:', error)
    return { text: DEFAULT_BRAND, isFallback: true }
  }
}

export const getServerBrandText = async (): Promise<string> => {
  const { text } = await getServerBranding()
  return text
}
