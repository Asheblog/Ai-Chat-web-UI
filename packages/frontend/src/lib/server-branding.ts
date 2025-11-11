'use server'

import type { ApiResponse } from '@/types'

const DEFAULT_BRAND = 'AIChat'

const buildBrandingEndpoint = () => {
  const publicApi = process.env.NEXT_PUBLIC_API_URL
  if (publicApi && /^https?:\/\//i.test(publicApi)) {
    return `${publicApi.replace(/\/$/, '')}/settings/branding`
  }
  const backendHost = process.env.BACKEND_HOST || 'localhost'
  const backendPort = process.env.BACKEND_INTERNAL_PORT || process.env.BACKEND_PORT || '8001'
  return `http://${backendHost}:${backendPort}/api/settings/branding`
}

export const getServerBrandText = async (): Promise<string> => {
  const endpoint = buildBrandingEndpoint()
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Branding request failed with status ${response.status}`)
    }
    const payload = (await response.json()) as ApiResponse<{ brand_text?: string }>
    const resolved = (payload.data?.brand_text || '').trim()
    return resolved || DEFAULT_BRAND
  } catch (error) {
    console.warn('[branding] fallback to default due to error:', error)
    return DEFAULT_BRAND
  }
}
