'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

const DEFAULT_TITLE = 'AIChat'

export function TitleSync() {
  const brandText = useSettingsStore((state) => state.systemSettings?.brandText)
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)
  const actorState = useAuthStore((state) => state.actorState)
  const fetchActor = useAuthStore((state) => state.fetchActor)
  const hasRequested = useRef(false)
  const lastBrandRef = useRef<string>('')

  useEffect(() => {
    if (actorState === 'loading') {
      fetchActor().catch(() => {})
    }
  }, [actorState, fetchActor])

  useEffect(() => {
    // 仅在已登录后请求系统设置，避免未认证状态触发 401 重定向
    if (actorState !== 'authenticated') {
      hasRequested.current = false
      return
    }
    const effectiveBrand = (brandText ?? '').trim() || lastBrandRef.current
    if (!hasRequested.current && !effectiveBrand) {
      hasRequested.current = true
      fetchSystemSettings().catch(() => {})
    }
  }, [actorState, brandText, fetchSystemSettings])

  useEffect(() => {
    const trimmed = (brandText ?? '').trim()
    if (trimmed) {
      lastBrandRef.current = trimmed
    }
  }, [brandText])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const nextTitle = (brandText ?? '').trim() || lastBrandRef.current || DEFAULT_TITLE
    if (document.title !== nextTitle) {
      document.title = nextTitle
    }
  }, [brandText])

  return null
}
