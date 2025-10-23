'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ChatInterface } from '@/components/chat-interface'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'

export default function ChatPage() {
  const { currentSession, fetchSessions } = useChatStore()
  const { fetchSystemSettings } = useSettingsStore()

  useEffect(() => {
    fetchSessions()
    fetchSystemSettings()
  }, [fetchSessions, fetchSystemSettings])

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {currentSession ? (
        <ChatInterface />
      ) : (
        <WelcomeScreen />
      )}
    </div>
  )
}
