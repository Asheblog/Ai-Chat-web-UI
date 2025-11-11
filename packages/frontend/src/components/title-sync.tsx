'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

const DEFAULT_TITLE = 'AIChat'

interface TitleSyncProps {
  initialBrandText?: string
}

export function TitleSync({ initialBrandText }: TitleSyncProps) {
  const brandText = useSettingsStore(
    (state) => state.systemSettings?.brandText ?? state.publicBrandText ?? null,
  )
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)
  const fetchPublicBranding = useSettingsStore((state) => state.fetchPublicBranding)
  const bootstrapBrandText = useSettingsStore((state) => state.bootstrapBrandText)
  const actorState = useAuthStore((state) => state.actorState)
  const fetchActor = useAuthStore((state) => state.fetchActor)
  const hasRequestedSystem = useRef(false)
  const hasRequestedBrand = useRef(false)
  const lastBrandRef = useRef<string>((initialBrandText ?? '').trim())

  useEffect(() => {
    if (actorState === 'loading') {
      fetchActor().catch(() => {})
    }
  }, [actorState, fetchActor])

  useEffect(() => {
    const trimmedInitial = (initialBrandText ?? '').trim()
    if (trimmedInitial) {
      bootstrapBrandText(trimmedInitial)
      hasRequestedBrand.current = true
      return
    }
    if (!brandText && !hasRequestedBrand.current) {
      hasRequestedBrand.current = true
      fetchPublicBranding().catch(() => {})
    }
  }, [initialBrandText, brandText, bootstrapBrandText, fetchPublicBranding])

  useEffect(() => {
    if (actorState !== 'authenticated') {
      hasRequestedSystem.current = false
      return
    }
    if (!hasRequestedSystem.current) {
      hasRequestedSystem.current = true
      fetchSystemSettings().catch(() => {})
    }
  }, [actorState, fetchSystemSettings])

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
