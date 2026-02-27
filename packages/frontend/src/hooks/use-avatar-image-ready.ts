'use client'

import { useEffect, useMemo, useState } from 'react'
import { isAvatarImageLoaded, normalizeAvatarUrl, preloadAvatarImage } from '@/lib/avatar-image-cache'

export function useAvatarImageReady(url?: string | null) {
  const normalized = useMemo(() => normalizeAvatarUrl(url), [url])
  const [ready, setReady] = useState(() => (normalized ? isAvatarImageLoaded(normalized) : false))

  useEffect(() => {
    if (!normalized) {
      setReady(false)
      return
    }

    if (isAvatarImageLoaded(normalized)) {
      setReady(true)
      return
    }

    setReady(false)
    let cancelled = false

    preloadAvatarImage(normalized).then((loaded) => {
      if (cancelled || !loaded) return
      setReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [normalized])

  return ready
}
