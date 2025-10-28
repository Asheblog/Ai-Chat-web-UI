'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

const DEFAULT_TITLE = 'AIChat'

export function TitleSync() {
  const brandText = useSettingsStore((state) => state.systemSettings?.brandText)
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)
  const user = useAuthStore((state) => state.user)
  const hasRequested = useRef(false)

  useEffect(() => {
    // 仅在已登录后请求系统设置，避免未认证状态触发 401 重定向
    if (!user) {
      hasRequested.current = false
      return
    }
    if (!hasRequested.current && !brandText) {
      hasRequested.current = true
      fetchSystemSettings().catch(() => {})
    }
  }, [user, brandText, fetchSystemSettings])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const nextTitle = brandText?.trim() || DEFAULT_TITLE
    if (document.title !== nextTitle) {
      document.title = nextTitle
    }
  }, [brandText])

  return null
}
