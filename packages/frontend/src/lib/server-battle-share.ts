'use server'

import type { ApiResponse, BattleShare } from '@/types'

const buildShareEndpoint = (): string => {
  const publicApi = process.env.NEXT_PUBLIC_API_URL
  if (publicApi && /^https?:\/\//i.test(publicApi)) {
    return `${publicApi.replace(/\/$/, '')}/battle/shares`
  }
  const backendHost = process.env.BACKEND_HOST || 'localhost'
  const backendPort = process.env.BACKEND_INTERNAL_PORT || process.env.BACKEND_PORT || '8001'
  return `http://${backendHost}:${backendPort}/api/battle/shares`
}

export async function fetchBattleShare(token: string): Promise<BattleShare | null> {
  if (!token) return null
  const base = buildShareEndpoint().replace(/\/$/, '')
  const endpoint = `${base}/${encodeURIComponent(token)}`
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as ApiResponse<BattleShare>
    if (!payload?.success || !payload.data) {
      return null
    }
    return payload.data
  } catch (error) {
    console.warn('[battle-share] failed to fetch share', error)
    return null
  }
}
