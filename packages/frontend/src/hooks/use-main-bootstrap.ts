'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/store/auth-store'
import { useChatStore } from '@/store/chat-store'
import { useModelsStore } from '@/store/models-store'
import { useSettingsStore } from '@/store/settings-store'

/**
 * /main 壳层唯一预热入口：system settings / sessions / models。
 * 组件层不应再各自发起平行的空则 fetch。
 */
export function useMainBootstrap(enabled: boolean) {
  const actorState = useAuthStore((state) => state.actorState)
  const fetchSystemSettings = useSettingsStore((state) => state.fetchSystemSettings)
  const fetchPublicBranding = useSettingsStore((state) => state.fetchPublicBranding)
  const fetchSessions = useChatStore((state) => state.fetchSessions)
  const fetchModels = useModelsStore((state) => state.fetchAll)
  const bootstrappedForActor = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (actorState === 'loading') return

    const key = actorState
    if (bootstrappedForActor.current === key) return
    bootstrappedForActor.current = key

    const tasks: Array<Promise<unknown>> = [
      fetchSessions().catch(() => {}),
      fetchModels().catch(() => {}),
    ]

    if (actorState === 'authenticated') {
      tasks.push(
        fetchSystemSettings().catch(() => {
          bootstrappedForActor.current = null
        }),
      )
    } else {
      tasks.push(
        fetchPublicBranding().catch(() => {
          bootstrappedForActor.current = null
        }),
      )
    }

    void Promise.all(tasks)
  }, [
    actorState,
    enabled,
    fetchModels,
    fetchPublicBranding,
    fetchSessions,
    fetchSystemSettings,
  ])
}
