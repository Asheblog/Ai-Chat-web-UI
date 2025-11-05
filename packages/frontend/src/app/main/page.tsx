'use client'
export const dynamic = 'force-dynamic'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WelcomeScreen } from '@/components/welcome-screen'
import { ChatInterface } from '@/components/chat-interface'
import { useChatStore } from '@/store/chat-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  welcomeScreenVariants,
  chatInterfaceVariants,
  pageTransition,
} from '@/lib/animations'

export default function ChatPage() {
  const { currentSession, fetchSessions } = useChatStore()
  const { fetchSystemSettings } = useSettingsStore()

  useEffect(() => {
    fetchSessions()
    fetchSystemSettings()
  }, [fetchSessions, fetchSystemSettings])

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {currentSession ? (
          <motion.div
            key="chat-interface"
            variants={chatInterfaceVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <ChatInterface />
          </motion.div>
        ) : (
          <motion.div
            key="welcome-screen"
            variants={welcomeScreenVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={pageTransition}
            className="flex-1 flex flex-col h-full min-h-0"
          >
            <WelcomeScreen />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
