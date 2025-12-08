import { create } from 'zustand'
import type { ChatStore } from './types'
import { createChatStoreRuntime } from './runtime'
import { createSessionSlice } from './slices/session-slice'
import { createUsageSlice } from './slices/usage-slice'
import { createMessageSlice } from './slices/message-slice'
import { createStreamSlice } from './slices/stream-slice'
import { createShareSlice } from './slices/share-slice'

export const createChatStoreInstance = () =>
  create<ChatStore>((set, get, api) => {
    const runtime = createChatStoreRuntime(set, get)
    return {
      ...createSessionSlice(set, get, runtime),
      ...createUsageSlice(set, get, runtime),
      ...createMessageSlice(set, get, runtime),
      ...createStreamSlice(set, get, runtime),
      ...createShareSlice(set, get, runtime),
      clearError: () => set({ error: null }),
    }
  })

export const useChatStore = createChatStoreInstance()

const buildSelector =
  <TSelected,>(selector: (state: ChatStore) => TSelected) =>
  (state: ChatStore) =>
    selector(state)

export const useChatSessions = <TSelected,>(selector: (slice: Pick<ChatStore, 'sessions' | 'currentSession' | 'isSessionsLoading' | 'error' | 'fetchSessions' | 'createSession' | 'selectSession' | 'deleteSession' | 'updateSessionTitle' | 'switchSessionModel' | 'updateSessionPrefs' | 'toggleSessionPin'>) => TSelected) =>
  useChatStore(buildSelector(selector))

export const useChatMessages = <TSelected,>(selector: (slice: Pick<ChatStore, 'messageMetas' | 'messageBodies' | 'messageRenderCache' | 'messageImageCache' | 'messagesHydrated' | 'isMessagesLoading' | 'toolEvents' | 'assistantVariantSelections' | 'fetchMessages' | 'addMessage' | 'applyRenderedContent' | 'invalidateRenderedContent' | 'regenerateAssistantMessage' | 'cycleAssistantVariant'>) => TSelected) =>
  useChatStore(buildSelector(selector))

export const useChatStreaming = <TSelected,>(selector: (slice: Pick<ChatStore, 'isStreaming' | 'activeStreamSessionId' | 'activeStreamCount' | 'streamingSessions' | 'sendMessage' | 'streamMessage' | 'stopStreaming'>) => TSelected) =>
  useChatStore(buildSelector(selector))

export type { ChatStore }
