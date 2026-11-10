'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useSettingsStore } from '@/store/settings-store'
import { getSharedBrandingController } from '@/components/title-sync-controller'

const DEFAULT_TITLE = 'AIChat'

interface TitleSyncProps {
  initialBrandText?: string
  initialBrandFallback?: boolean
}

export function TitleSync({ initialBrandText, initialBrandFallback = false }: TitleSyncProps) {
  const brandText = useSettingsStore(
    (state) => state.systemSettings?.brandText ?? state.publicBrandText ?? null,
  )
  const fetchPublicBranding = useSettingsStore((state) => state.fetchPublicBranding)
  const bootstrapBrandText = useSettingsStore((state) => state.bootstrapBrandText)
  const actorState = useAuthStore((state) => state.actorState)
  const fetchActor = useAuthStore((state) => state.fetchActor)
  const lastBrandRef = useRef<string>((initialBrandText ?? '').trim())
  const previousActorStateRef = useRef(actorState)

  // 启动即让服务端确认真实身份：本地快照只用于首屏占位，不能当作「已登录」依据。
  // store 内部有 in-flight 去重，StrictMode 双挂载只发一次请求。
  useEffect(() => {
    fetchActor().catch(() => {})
  }, [fetchActor])

  useEffect(() => {
    const options = {
      initialBrandText,
      initialBrandFallback,
      fetchBranding: fetchPublicBranding,
      bootstrapBrandText,
    }
    const controller = getSharedBrandingController(options)
    controller.updateOptions(options)
    controller.start()
    return () => controller.dispose()
  }, [initialBrandText, initialBrandFallback, bootstrapBrandText, fetchPublicBranding])

  useEffect(() => {
    const previous = previousActorStateRef.current
    previousActorStateRef.current = actorState
    // loading → 已就绪 属于首轮拉取，由 start 处理；只对真实身份切换刷新。
    if (previous === 'loading' || previous === actorState) return
    getSharedBrandingController({
      initialBrandText,
      initialBrandFallback,
      fetchBranding: fetchPublicBranding,
      bootstrapBrandText,
    }).refresh()
  }, [actorState, initialBrandText, initialBrandFallback, bootstrapBrandText, fetchPublicBranding])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => {
      getSharedBrandingController({
        initialBrandText,
        initialBrandFallback,
        fetchBranding: fetchPublicBranding,
        bootstrapBrandText,
      }).refresh()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [initialBrandText, initialBrandFallback, bootstrapBrandText, fetchPublicBranding])

  useEffect(() => {
    const trimmed = (brandText ?? '').trim()
    if (trimmed) lastBrandRef.current = trimmed
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
