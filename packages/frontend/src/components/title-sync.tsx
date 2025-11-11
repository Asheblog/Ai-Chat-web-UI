'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'

const DEFAULT_TITLE = 'AIChat'

interface TitleSyncProps {
  initialBrandText?: string
  initialBrandFallback?: boolean
}

export function TitleSync({ initialBrandText, initialBrandFallback = false }: TitleSyncProps) {
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
  const fallbackRetryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; attempts: number }>({
    timer: null,
    attempts: 0,
  })

  useEffect(() => {
    if (actorState === 'loading') {
      fetchActor().catch(() => {})
    }
  }, [actorState, fetchActor])

  useEffect(() => {
    const trimmedInitial = (initialBrandText ?? '').trim()
    if (trimmedInitial) {
      bootstrapBrandText(trimmedInitial)
      if (!initialBrandFallback) {
        hasRequestedBrand.current = true
        return
      }
    }
    if (!brandText && !hasRequestedBrand.current) {
      hasRequestedBrand.current = true
      fetchPublicBranding()
        .then((success) => {
          if (!success) {
            hasRequestedBrand.current = false
          }
        })
        .catch(() => {
          hasRequestedBrand.current = false
        })
    }
  }, [initialBrandText, initialBrandFallback, brandText, bootstrapBrandText, fetchPublicBranding])

  useEffect(() => {
    const retryState = fallbackRetryRef.current

    if (!initialBrandFallback) {
      return () => {
        if (retryState.timer) {
          clearTimeout(retryState.timer)
          retryState.timer = null
        }
      }
    }

    let cancelled = false
    retryState.attempts = 0

    const scheduleRetry = () => {
      const attempt = retryState.attempts
      const delay = Math.min(30000, 2000 * Math.max(1, attempt + 1))
      retryState.timer = setTimeout(async () => {
        if (cancelled) {
          return
        }
        const success = await fetchPublicBranding()
        if (cancelled) {
          return
        }
        if (success) {
          if (retryState.timer) {
            clearTimeout(retryState.timer)
            retryState.timer = null
          }
          return
        }
        retryState.attempts = attempt + 1
        scheduleRetry()
      }, delay)
    }

    // 立即尝试一次；如失败再进入调度
    fetchPublicBranding()
      .then((success) => {
        if (cancelled || success) return
        scheduleRetry()
      })
      .catch(() => {
        if (cancelled) return
        scheduleRetry()
      })

    return () => {
      cancelled = true
      if (retryState.timer) {
        clearTimeout(retryState.timer)
        retryState.timer = null
      }
    }
  }, [initialBrandFallback, fetchPublicBranding])

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
      const retryState = fallbackRetryRef.current
      if (retryState.timer) {
        clearTimeout(retryState.timer)
        retryState.timer = null
      }
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
