'use client'

import { useEffect, useRef } from 'react'
import { useSettingsStore } from '@/store/settings-store'

const DEFAULT_TITLE = 'AIChat'

export function TitleSync() {
  const brandText = useSettingsStore((state) => state.systemSettings?.brandText)
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)
  const hasRequested = useRef(false)

  useEffect(() => {
    if (!hasRequested.current && !brandText) {
      hasRequested.current = true
      fetchSystemSettings().catch(() => {})
    }
  }, [brandText, fetchSystemSettings])

  useEffect(() => {
    if (typeof document === 'undefined') return
    const nextTitle = brandText?.trim() || DEFAULT_TITLE
    if (document.title !== nextTitle) {
      document.title = nextTitle
    }
  }, [brandText])

  return null
}
