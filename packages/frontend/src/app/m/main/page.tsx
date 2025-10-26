'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import { MobileChatInterface } from '@/components/mobile/mobile-chat'

export default function MobileChatPage() {
  const { fetchSessions } = useChatStore()
  const { fetchSystemSettings } = useSettingsStore()

  useEffect(() => {
    fetchSessions()
    fetchSystemSettings()
  }, [fetchSessions, fetchSystemSettings])

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <MobileChatInterface />
    </div>
  )
}
